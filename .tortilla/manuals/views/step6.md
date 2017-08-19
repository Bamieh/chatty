# Step 6: GraphQL Subscriptions

This is the fifth blog in a multipart series where we will be building Chatty, a WhatsApp clone, using [React Native](https://facebook.github.io/react-native/) and [Apollo](http://dev.apollodata.com/).

In this tutorial, we’ll focus on adding [GraphQL Subscriptions](http://graphql.org/blog/subscriptions-in-graphql-and-relay/), which will give our app real-time instant messaging capabilities!

Here’s what we will accomplish in this tutorial:
1. Introduce Event-based Subscriptions
2. Build server-side infrastructure to handle **GraphQL Subscriptions** via WebSockets
3. Design GraphQL Subscriptions and add them to our GraphQL Schemas and Resolvers
4. Build client-side infrastructure to handle GraphQL Subscriptions via WebSockets
5. Subscribe to GraphQL Subscriptions on our React Native client and handle real-time updates

# Event-based Subscriptions
Real-time capable apps need a way to be pushed data from the server. In some real-time architectures, all data is considered live data, and anytime data changes on the server, it’s pushed through a WebSocket or long-polling and updated on the client. While this sort of architecture means we can expect data to update on the client without writing extra code, it starts to get tricky and non-performant as apps scale. For one thing, you don’t need to keep track of every last bit of data if it’s not relevant to the user. Moreover, it’s not obvious what changes to data should trigger an event, what that event should look like, and how our clients should react.

With an event-based subscription model in GraphQL — much like with queries and mutations — a client can tell the server exactly what data it wants to be pushed and what that data should look like. This leads to fewer events tracked on the server and pushed to the client, and precise event handling on both ends!

# GraphQL Subscriptions on the Server
It’s probably easiest to think about our event based subscriptions setup from the client’s perspective. All queries and mutations will still get executed with standard HTTP requests. This will keep request execution more reliable and the WebSocket connection unclogged. We will only use WebSockets for subscriptions, and the client will only subscribe to events it cares about — the ones that affect stuff for the current user.

## Designing GraphQL Subscriptions
Let’s focus on the most important event that ever happens within a messaging app — getting a new message.

When someone creates a new message, we want all group members to be notified that a new message was created. We don’t want our users to know about every new message being created by everybody on Chatty, so we’ll create a system where users **subscribe** to new message events just for their own groups. We can build this subscription model right into our GraphQL Schema!

Let’s modify our GraphQL Schema in `server/data/schema.js` to include a **GraphQL Subscription** for when new messages are added to a group we care about:

[{]: <helper> (diffStep 6.1)

#### Step 6.1: Add Subscription to Schema

##### Changed server&#x2F;data&#x2F;schema.js
```diff
@@ -52,10 +52,17 @@
 ┊52┊52┊    leaveGroup(id: Int!, userId: Int!): Group # let user leave group
 ┊53┊53┊    updateGroup(id: Int!, name: String): Group
 ┊54┊54┊  }
+┊  ┊55┊
+┊  ┊56┊  type Subscription {
+┊  ┊57┊    # Subscription fires on every message added
+┊  ┊58┊    # for any of the groups with one of these groupIds
+┊  ┊59┊    messageAdded(groupIds: [Int]): Message
+┊  ┊60┊  }
 ┊55┊61┊  
 ┊56┊62┊  schema {
 ┊57┊63┊    query: Query
 ┊58┊64┊    mutation: Mutation
+┊  ┊65┊    subscription: Subscription
 ┊59┊66┊  }
 ┊60┊67┊`];
```

[}]: #

That’s it!

## GraphQL Subscription Infrastructure
Our Schema uses GraphQL Subscriptions, but our server infrastructure has no way to handle them.

We will use two excellent packages from the Apollo team  — [` subscription-transport-ws`](https://www.npmjs.com/package/subscriptions-transport-ws) and [`graphql-subscriptions`](https://www.npmjs.com/package/graphql-subscriptions)  —  to hook up our GraphQL server with subscription capabilities:
```
yarn add graphql-subscriptions subscriptions-transport-ws
```

First, we’ll use `graphql-subscriptions` to create a `PubSub` manager. `PubSub` is basically just event emitters wrapped with a function that filters messages. It can easily be replaced later with something more advanced like [`graphql-redis-subscriptions`](https://github.com/davidyaha/graphql-redis-subscriptions).

Let’s create a new file `server/subscriptions.js` where we’ll start fleshing out our subscription infrastructure:

[{]: <helper> (diffStep 6.2 files="server/subscriptions.js")

#### Step 6.2: Create subscriptions.js

##### Added server&#x2F;subscriptions.js
```diff
@@ -0,0 +1,5 @@
+┊ ┊1┊import { PubSub } from 'graphql-subscriptions';
+┊ ┊2┊
+┊ ┊3┊export const pubsub = new PubSub();
+┊ ┊4┊
+┊ ┊5┊export default pubsub;
```

[}]: #

We're going to need the same `executableSchema` we created in `server/index.js`, so let’s pull out executableSchema from `server/index.js` and put it inside `server/data/schema.js` so other files can use `executableSchema`.

[{]: <helper> (diffStep 6.3)

#### Step 6.3: Refactor schema.js to export executableSchema

##### Changed server&#x2F;data&#x2F;schema.js
```diff
@@ -1,3 +1,8 @@
+┊ ┊1┊import { addMockFunctionsToSchema, makeExecutableSchema } from 'graphql-tools';
+┊ ┊2┊
+┊ ┊3┊import { Mocks } from './mocks';
+┊ ┊4┊import { Resolvers } from './resolvers';
+┊ ┊5┊
 ┊1┊6┊export const Schema = [`
 ┊2┊7┊  # declare custom scalars
 ┊3┊8┊  scalar Date
```
```diff
@@ -66,4 +71,15 @@
 ┊66┊71┊  }
 ┊67┊72┊`];
 ┊68┊73┊
-┊69┊  ┊export default Schema;
+┊  ┊74┊export const executableSchema = makeExecutableSchema({
+┊  ┊75┊  typeDefs: Schema,
+┊  ┊76┊  resolvers: Resolvers,
+┊  ┊77┊});
+┊  ┊78┊
+┊  ┊79┊// addMockFunctionsToSchema({
+┊  ┊80┊//   schema: executableSchema,
+┊  ┊81┊//   mocks: Mocks,
+┊  ┊82┊//   preserveResolvers: true,
+┊  ┊83┊// });
+┊  ┊84┊
+┊  ┊85┊export default executableSchema;
```

##### Changed server&#x2F;index.js
```diff
@@ -1,29 +1,13 @@
 ┊ 1┊ 1┊import express from 'express';
 ┊ 2┊ 2┊import { graphqlExpress, graphiqlExpress } from 'graphql-server-express';
-┊ 3┊  ┊import { makeExecutableSchema, addMockFunctionsToSchema } from 'graphql-tools';
 ┊ 4┊ 3┊import bodyParser from 'body-parser';
 ┊ 5┊ 4┊import { createServer } from 'http';
 ┊ 6┊ 5┊
-┊ 7┊  ┊import { Resolvers } from './data/resolvers';
-┊ 8┊  ┊import { Schema } from './data/schema';
-┊ 9┊  ┊import { Mocks } from './data/mocks';
+┊  ┊ 6┊import { executableSchema } from './data/schema';
 ┊10┊ 7┊
 ┊11┊ 8┊const GRAPHQL_PORT = 8080;
 ┊12┊ 9┊const app = express();
 ┊13┊10┊
-┊14┊  ┊const executableSchema = makeExecutableSchema({
-┊15┊  ┊  typeDefs: Schema,
-┊16┊  ┊  resolvers: Resolvers,
-┊17┊  ┊});
-┊18┊  ┊
-┊19┊  ┊// we can comment out this code for mocking data
-┊20┊  ┊// we're using REAL DATA now!
-┊21┊  ┊// addMockFunctionsToSchema({
-┊22┊  ┊//   schema: executableSchema,
-┊23┊  ┊//   mocks: Mocks,
-┊24┊  ┊//   preserveResolvers: true,
-┊25┊  ┊// });
-┊26┊  ┊
 ┊27┊11┊// `context` must be an object and can't be undefined when using connectors
 ┊28┊12┊app.use('/graphql', bodyParser.json(), graphqlExpress({
 ┊29┊13┊  schema: executableSchema,
```

[}]: #

Now that we’ve created a `PubSub`, we can use this class to publish and subscribe to events as they occur in our Resolvers.

We can modify `server/data/resolvers.js` as follows:

[{]: <helper> (diffStep 6.4)

#### Step 6.4: Add Subscription to Resolvers

##### Changed server&#x2F;data&#x2F;resolvers.js
```diff
@@ -1,6 +1,9 @@
 ┊1┊1┊import GraphQLDate from 'graphql-date';
 ┊2┊2┊
 ┊3┊3┊import { Group, Message, User } from './connectors';
+┊ ┊4┊import { pubsub } from '../subscriptions';
+┊ ┊5┊
+┊ ┊6┊const MESSAGE_ADDED_TOPIC = 'messageAdded';
 ┊4┊7┊
 ┊5┊8┊export const Resolvers = {
 ┊6┊9┊  Date: GraphQLDate,
```
```diff
@@ -24,6 +27,10 @@
 ┊24┊27┊        userId,
 ┊25┊28┊        text,
 ┊26┊29┊        groupId,
+┊  ┊30┊      }).then((message) => {
+┊  ┊31┊        // publish subscription notification with the whole message
+┊  ┊32┊        pubsub.publish(MESSAGE_ADDED_TOPIC, { [MESSAGE_ADDED_TOPIC]: message });
+┊  ┊33┊        return message;
 ┊27┊34┊      });
 ┊28┊35┊    },
 ┊29┊36┊    createGroup(_, { name, userIds, userId }) {
```
```diff
@@ -65,6 +72,12 @@
 ┊65┊72┊        .then(group => group.update({ name }));
 ┊66┊73┊    },
 ┊67┊74┊  },
+┊  ┊75┊  Subscription: {
+┊  ┊76┊    messageAdded: {
+┊  ┊77┊      // the subscription payload is the message.
+┊  ┊78┊      subscribe: () => pubsub.asyncIterator(MESSAGE_ADDED_TOPIC),
+┊  ┊79┊    },
+┊  ┊80┊  },
 ┊68┊81┊  Group: {
 ┊69┊82┊    users(group) {
 ┊70┊83┊      return group.getUsers();
```

[}]: #

Whenever a user creates a message, we trigger `pubsub` to publish the `messageAdded` event along with the newly created message. `PubSub` will emit an event to any clients subscribed to `messageAdded` and pass them the new message.

But we only want to emit this event to clients who care about the message because it was sent to one of their user’s groups! We can modify our implementation to filter who gets the event emission:

[{]: <helper> (diffStep 6.5)

#### Step 6.5: Add withFilter to messageAdded

##### Changed server&#x2F;data&#x2F;resolvers.js
```diff
@@ -1,4 +1,5 @@
 ┊1┊1┊import GraphQLDate from 'graphql-date';
+┊ ┊2┊import { withFilter } from 'graphql-subscriptions';
 ┊2┊3┊
 ┊3┊4┊import { Group, Message, User } from './connectors';
 ┊4┊5┊import { pubsub } from '../subscriptions';
```
```diff
@@ -74,8 +75,16 @@
 ┊74┊75┊  },
 ┊75┊76┊  Subscription: {
 ┊76┊77┊    messageAdded: {
-┊77┊  ┊      // the subscription payload is the message.
-┊78┊  ┊      subscribe: () => pubsub.asyncIterator(MESSAGE_ADDED_TOPIC),
+┊  ┊78┊      subscribe: withFilter(
+┊  ┊79┊        () => pubsub.asyncIterator(MESSAGE_ADDED_TOPIC),
+┊  ┊80┊        (payload, args) => {
+┊  ┊81┊          return Boolean(
+┊  ┊82┊            args.groupIds &&
+┊  ┊83┊            ~args.groupIds.indexOf(payload.messageAdded.groupId) &&
+┊  ┊84┊            args.userId !== payload.messageAdded.userId, // don't send to user creating message
+┊  ┊85┊          );
+┊  ┊86┊        },
+┊  ┊87┊      ),
 ┊79┊88┊    },
 ┊80┊89┊  },
 ┊81┊90┊  Group: {
```

[}]: #

Using `withFilter`, we create a `filter` which returns true when the `groupId` of a new message matches one of the `groupIds` passed into our `messageAdded` subscription. This filter will be applied whenever `pubsub.publish(MESSAGE_ADDED_TOPIC, { [MESSAGE_ADDED_TOPIC]: message })` is triggered, and only clients whose subscriptions pass the filter will receive the message.

Our Resolvers are all set up. Time to hook our server up to WebSockets!

## Creating the SubscriptionServer
Our server will serve subscriptions via WebSockets, keeping an open connection with clients. `subscription-transport-ws` exposes a `SubscriptionServer` module that, when given a server, an endpoint, and the `execute` and `subscribe` modules from `graphql`, will tie everything together. The `SubscriptionServer` will rely on the Resolvers to manage emitting events to subscribed clients over the endpoint via WebSockets. How cool is that?!

Inside `server/index.js`, let’s attach a new `SubscriptionServer` to our current server and have it use `ws://localhost:8080/subscriptions` (`SUBSCRIPTIONS_PATH`) as our subscription endpoint:

[{]: <helper> (diffStep 6.6)

#### Step 6.6: Create SubscriptionServer

##### Changed server&#x2F;index.js
```diff
@@ -2,10 +2,15 @@
 ┊ 2┊ 2┊import { graphqlExpress, graphiqlExpress } from 'graphql-server-express';
 ┊ 3┊ 3┊import bodyParser from 'body-parser';
 ┊ 4┊ 4┊import { createServer } from 'http';
+┊  ┊ 5┊import { SubscriptionServer } from 'subscriptions-transport-ws';
+┊  ┊ 6┊import { execute, subscribe } from 'graphql';
 ┊ 5┊ 7┊
 ┊ 6┊ 8┊import { executableSchema } from './data/schema';
 ┊ 7┊ 9┊
 ┊ 8┊10┊const GRAPHQL_PORT = 8080;
+┊  ┊11┊const GRAPHQL_PATH = '/graphql';
+┊  ┊12┊const SUBSCRIPTIONS_PATH = '/subscriptions';
+┊  ┊13┊
 ┊ 9┊14┊const app = express();
 ┊10┊15┊
 ┊11┊16┊// `context` must be an object and can't be undefined when using connectors
```
```diff
@@ -15,9 +20,23 @@
 ┊15┊20┊}));
 ┊16┊21┊
 ┊17┊22┊app.use('/graphiql', graphiqlExpress({
-┊18┊  ┊  endpointURL: '/graphql',
+┊  ┊23┊  endpointURL: GRAPHQL_PATH,
+┊  ┊24┊  subscriptionsEndpoint: `ws://localhost:${GRAPHQL_PORT}${SUBSCRIPTIONS_PATH}`,
 ┊19┊25┊}));
 ┊20┊26┊
 ┊21┊27┊const graphQLServer = createServer(app);
 ┊22┊28┊
-┊23┊  ┊graphQLServer.listen(GRAPHQL_PORT, () => console.log(`GraphQL Server is now running on http://localhost:${GRAPHQL_PORT}/graphql`));
+┊  ┊29┊graphQLServer.listen(GRAPHQL_PORT, () => {
+┊  ┊30┊  console.log(`GraphQL Server is now running on http://localhost:${GRAPHQL_PORT}${GRAPHQL_PATH}`);
+┊  ┊31┊  console.log(`GraphQL Subscriptions are now running on ws://localhost:${GRAPHQL_PORT}${SUBSCRIPTIONS_PATH}`);
+┊  ┊32┊});
+┊  ┊33┊
+┊  ┊34┊// eslint-disable-next-line no-unused-vars
+┊  ┊35┊const subscriptionServer = SubscriptionServer.create({
+┊  ┊36┊  schema: executableSchema,
+┊  ┊37┊  execute,
+┊  ┊38┊  subscribe,
+┊  ┊39┊}, {
+┊  ┊40┊  server: graphQLServer,
+┊  ┊41┊  path: SUBSCRIPTIONS_PATH,
+┊  ┊42┊});
```

[}]: #

You might have noticed that we also updated our `/graphiql` endpoint to include a subscriptionsEndpoint. That’s right  —  we can track our subscriptions in GraphIQL!

A GraphQL Subscription is written on the client much like a query or mutation. For example, in GraphIQL, we could write the following GraphQL Subscription for `messageAdded`:
```
subscription messageAdded($groupIds: [Int]){
  messageAdded(groupIds: $groupIds) {
    id
    to {
      name
    }
    from {
      username
    }
    text
  }
}
```

Let’s check out GraphIQL and see if everything works: ![GraphIQL Gif](https://s3-us-west-1.amazonaws.com/tortilla/chatty/step6-6.gif)

## New Subscription Workflow
We’ve successfully set up GraphQL Subscriptions on our server.

Since we have the infrastructure in place, let’s add one more subscription for some extra practice. We can use the same methodology we used for subscribing to new `Messages` and apply it to new `Groups`. After all, it’s important that our users know right away that they’ve been added to a new group.

The steps are as follows:
1. Add the subscription to our Schema:

[{]: <helper> (diffStep 6.7)

#### Step 6.7: Add groupAdded to Schema

##### Changed server&#x2F;data&#x2F;schema.js
```diff
@@ -62,6 +62,7 @@
 ┊62┊62┊    # Subscription fires on every message added
 ┊63┊63┊    # for any of the groups with one of these groupIds
 ┊64┊64┊    messageAdded(groupIds: [Int]): Message
+┊  ┊65┊    groupAdded(userId: Int): Group
 ┊65┊66┊  }
 ┊66┊67┊  
 ┊67┊68┊  schema {
```

[}]: #

2. Publish to the subscription when a new `Group` is created and resolve the subscription in the Resolvers:

[{]: <helper> (diffStep 6.8)

#### Step 6.8: Add groupAdded to Resolvers

##### Changed server&#x2F;data&#x2F;resolvers.js
```diff
@@ -5,6 +5,7 @@
 ┊ 5┊ 5┊import { pubsub } from '../subscriptions';
 ┊ 6┊ 6┊
 ┊ 7┊ 7┊const MESSAGE_ADDED_TOPIC = 'messageAdded';
+┊  ┊ 8┊const GROUP_ADDED_TOPIC = 'groupAdded';
 ┊ 8┊ 9┊
 ┊ 9┊10┊export const Resolvers = {
 ┊10┊11┊  Date: GraphQLDate,
```
```diff
@@ -42,8 +43,13 @@
 ┊42┊43┊            users: [user, ...friends],
 ┊43┊44┊          })
 ┊44┊45┊            .then(group => group.addUsers([user, ...friends])
-┊45┊  ┊              .then(() => group),
-┊46┊  ┊            ),
+┊  ┊46┊              .then((res) => {
+┊  ┊47┊                // append the user list to the group object
+┊  ┊48┊                // to pass to pubsub so we can check members
+┊  ┊49┊                group.users = [user, ...friends];
+┊  ┊50┊                pubsub.publish(GROUP_ADDED_TOPIC, { [GROUP_ADDED_TOPIC]: group });
+┊  ┊51┊                return group;
+┊  ┊52┊              })),
 ┊47┊53┊          ),
 ┊48┊54┊        );
 ┊49┊55┊    },
```
```diff
@@ -86,6 +92,9 @@
 ┊ 86┊ 92┊        },
 ┊ 87┊ 93┊      ),
 ┊ 88┊ 94┊    },
+┊   ┊ 95┊    groupAdded: {
+┊   ┊ 96┊      subscribe: () => pubsub.asyncIterator(GROUP_ADDED_TOPIC),
+┊   ┊ 97┊    },
 ┊ 89┊ 98┊  },
 ┊ 90┊ 99┊  Group: {
 ┊ 91┊100┊    users(group) {
```

[}]: #

3. Filter the recipients of the emitted new group with `withFilter`:

[{]: <helper> (diffStep 6.9)

#### Step 6.9: Add withFilter to groupAdded

##### Changed server&#x2F;data&#x2F;resolvers.js
```diff
@@ -1,5 +1,6 @@
 ┊1┊1┊import GraphQLDate from 'graphql-date';
 ┊2┊2┊import { withFilter } from 'graphql-subscriptions';
+┊ ┊3┊import { map } from 'lodash';
 ┊3┊4┊
 ┊4┊5┊import { Group, Message, User } from './connectors';
 ┊5┊6┊import { pubsub } from '../subscriptions';
```
```diff
@@ -93,7 +94,16 @@
 ┊ 93┊ 94┊      ),
 ┊ 94┊ 95┊    },
 ┊ 95┊ 96┊    groupAdded: {
-┊ 96┊   ┊      subscribe: () => pubsub.asyncIterator(GROUP_ADDED_TOPIC),
+┊   ┊ 97┊      subscribe: withFilter(
+┊   ┊ 98┊        () => pubsub.asyncIterator(GROUP_ADDED_TOPIC),
+┊   ┊ 99┊        (payload, args) => {
+┊   ┊100┊          return Boolean(
+┊   ┊101┊            args.userId &&
+┊   ┊102┊            ~map(payload.groupAdded.users, 'id').indexOf(args.userId) &&
+┊   ┊103┊            args.userId !== payload.groupAdded.users[0].id, // don't send to user creating group
+┊   ┊104┊          );
+┊   ┊105┊        },
+┊   ┊106┊      ),
 ┊ 97┊107┊    },
 ┊ 98┊108┊  },
 ┊ 99┊109┊  Group: {
```

[}]: #

All set!

# GraphQL Subscriptions on the Client
Time to add subscriptions inside our React Native client. We’ll start by adding `subscriptions-transport-ws` to our client:
```
# make sure you're adding the package in the client!!!
cd client
yarn add subscriptions-transport-ws
```

We’ll use `subscription-transport-ws` on the client to connect to our WebSocket endpoint and extend the `networkInterface` we pass into `ApolloClient` to handle subscriptions on the endpoint:

[{]: <helper> (diffStep "6.10" files="client/src/app.js")

#### Step 6.10: Add wsClient to networkInterface

##### Changed client&#x2F;src&#x2F;app.js
```diff
@@ -4,12 +4,28 @@
 ┊ 4┊ 4┊import { createStore, combineReducers, applyMiddleware } from 'redux';
 ┊ 5┊ 5┊import { composeWithDevTools } from 'redux-devtools-extension';
 ┊ 6┊ 6┊import ApolloClient, { createNetworkInterface } from 'apollo-client';
+┊  ┊ 7┊import { SubscriptionClient, addGraphQLSubscriptions } from 'subscriptions-transport-ws';
 ┊ 7┊ 8┊
 ┊ 8┊ 9┊import AppWithNavigationState, { navigationReducer } from './navigation';
 ┊ 9┊10┊
 ┊10┊11┊const networkInterface = createNetworkInterface({ uri: 'http://localhost:8080/graphql' });
-┊11┊  ┊const client = new ApolloClient({
+┊  ┊12┊
+┊  ┊13┊// Create WebSocket client
+┊  ┊14┊const wsClient = new SubscriptionClient('ws://localhost:8080/subscriptions', {
+┊  ┊15┊  reconnect: true,
+┊  ┊16┊  connectionParams: {
+┊  ┊17┊    // Pass any arguments you want for initialization
+┊  ┊18┊  },
+┊  ┊19┊});
+┊  ┊20┊
+┊  ┊21┊// Extend the network interface with the WebSocket
+┊  ┊22┊const networkInterfaceWithSubscriptions = addGraphQLSubscriptions(
 ┊12┊23┊  networkInterface,
+┊  ┊24┊  wsClient,
+┊  ┊25┊);
+┊  ┊26┊
+┊  ┊27┊const client = new ApolloClient({
+┊  ┊28┊  networkInterface: networkInterfaceWithSubscriptions,
 ┊13┊29┊});
 ┊14┊30┊
 ┊15┊31┊const store = createStore(
```

[}]: #

That’s it — we’re ready to start adding subscriptions!

# Designing GraphQL Subscriptions
Our GraphQL Subscriptions are going to be ridiculously easy to write now that we’ve had practice with queries and mutations. We’ll first write our `messageAdded` subscription in a new file `client/src/graphql/message-added.subscription.js`:

[{]: <helper> (diffStep 6.11)

#### Step 6.11: Create MESSAGE_ADDED_SUBSCRIPTION

##### Added client&#x2F;src&#x2F;graphql&#x2F;message-added.subscription.js
```diff
@@ -0,0 +1,14 @@
+┊  ┊ 1┊import gql from 'graphql-tag';
+┊  ┊ 2┊
+┊  ┊ 3┊import MESSAGE_FRAGMENT from './message.fragment';
+┊  ┊ 4┊
+┊  ┊ 5┊const MESSAGE_ADDED_SUBSCRIPTION = gql`
+┊  ┊ 6┊  subscription onMessageAdded($groupIds: [Int]){
+┊  ┊ 7┊    messageAdded(groupIds: $groupIds){
+┊  ┊ 8┊      ... MessageFragment
+┊  ┊ 9┊    }
+┊  ┊10┊  }
+┊  ┊11┊  ${MESSAGE_FRAGMENT}
+┊  ┊12┊`;
+┊  ┊13┊
+┊  ┊14┊export default MESSAGE_ADDED_SUBSCRIPTION;
```

[}]: #

I’ve retitled the subscription `onMessageAdded` to distinguish the name from the subscription itself.

The `groupAdded` component will look extremely similar:

[{]: <helper> (diffStep 6.12)

#### Step 6.12: Create GROUP_ADDED_SUBSCRIPTION

##### Added client&#x2F;src&#x2F;graphql&#x2F;group-added.subscription.js
```diff
@@ -0,0 +1,18 @@
+┊  ┊ 1┊import gql from 'graphql-tag';
+┊  ┊ 2┊
+┊  ┊ 3┊import MESSAGE_FRAGMENT from './message.fragment';
+┊  ┊ 4┊
+┊  ┊ 5┊const GROUP_ADDED_SUBSCRIPTION = gql`
+┊  ┊ 6┊  subscription onGroupAdded($userId: Int){
+┊  ┊ 7┊    groupAdded(userId: $userId){
+┊  ┊ 8┊      id
+┊  ┊ 9┊      name
+┊  ┊10┊      messages(limit: 1) {
+┊  ┊11┊        ... MessageFragment
+┊  ┊12┊      }
+┊  ┊13┊    }
+┊  ┊14┊  }
+┊  ┊15┊  ${MESSAGE_FRAGMENT}
+┊  ┊16┊`;
+┊  ┊17┊
+┊  ┊18┊export default GROUP_ADDED_SUBSCRIPTION;🚫↵
```

[}]: #

Our subscriptions are fired up and ready to go. We just need to add them to our UI/UX and we’re finished.

## Connecting Subscriptions to Components
Our final step is to connect our new subscriptions to our React Native components.

Let’s first apply `messageAdded` to the `Messages` component. When a user is looking at messages within a group thread, we want new messages to pop onto the thread as they’re created.

The `graphql` module in `react-apollo` exposes a `prop` function named `subscribeToMore` that can attach subscriptions to a component. Inside the `subscribeToMore` function, we pass the subscription, variables, and tell the component how to modify query data state with `updateQuery`.

Take a look at the updated code in our `Messages` component in `client/src/screens/messages.screen.js`:

[{]: <helper> (diffStep 6.13)

#### Step 6.13: Apply subscribeToMore to Messages

##### Changed client&#x2F;src&#x2F;screens&#x2F;messages.screen.js
```diff
@@ -21,6 +21,7 @@
 ┊21┊21┊import GROUP_QUERY from '../graphql/group.query';
 ┊22┊22┊import CREATE_MESSAGE_MUTATION from '../graphql/create-message.mutation';
 ┊23┊23┊import USER_QUERY from '../graphql/user.query';
+┊  ┊24┊import MESSAGE_ADDED_SUBSCRIPTION from '../graphql/message-added.subscription';
 ┊24┊25┊
 ┊25┊26┊const styles = StyleSheet.create({
 ┊26┊27┊  container: {
```
```diff
@@ -106,6 +107,26 @@
 ┊106┊107┊        });
 ┊107┊108┊      }
 ┊108┊109┊
+┊   ┊110┊      // we don't resubscribe on changed props
+┊   ┊111┊      // because it never happens in our app
+┊   ┊112┊      if (!this.subscription) {
+┊   ┊113┊        this.subscription = nextProps.subscribeToMore({
+┊   ┊114┊          document: MESSAGE_ADDED_SUBSCRIPTION,
+┊   ┊115┊          variables: { groupIds: [nextProps.navigation.state.params.groupId] },
+┊   ┊116┊          updateQuery: (previousResult, { subscriptionData }) => {
+┊   ┊117┊            const newMessage = subscriptionData.data.messageAdded;
+┊   ┊118┊
+┊   ┊119┊            return update(previousResult, {
+┊   ┊120┊              group: {
+┊   ┊121┊                messages: {
+┊   ┊122┊                  $unshift: [newMessage],
+┊   ┊123┊                },
+┊   ┊124┊              },
+┊   ┊125┊            });
+┊   ┊126┊          },
+┊   ┊127┊        });
+┊   ┊128┊      }
+┊   ┊129┊
 ┊109┊130┊      this.setState({
 ┊110┊131┊        usernameColors,
 ┊111┊132┊      });
```
```diff
@@ -196,6 +217,7 @@
 ┊196┊217┊  }),
 ┊197┊218┊  loading: PropTypes.bool,
 ┊198┊219┊  loadMoreEntries: PropTypes.func,
+┊   ┊220┊  subscribeToMore: PropTypes.func,
 ┊199┊221┊};
 ┊200┊222┊
 ┊201┊223┊const ITEMS_PER_PAGE = 10;
```
```diff
@@ -207,9 +229,10 @@
 ┊207┊229┊      limit: ITEMS_PER_PAGE,
 ┊208┊230┊    },
 ┊209┊231┊  }),
-┊210┊   ┊  props: ({ data: { fetchMore, loading, group } }) => ({
+┊   ┊232┊  props: ({ data: { fetchMore, loading, group, subscribeToMore } }) => ({
 ┊211┊233┊    loading,
 ┊212┊234┊    group,
+┊   ┊235┊    subscribeToMore,
 ┊213┊236┊    loadMoreEntries() {
 ┊214┊237┊      return fetchMore({
 ┊215┊238┊        // query: ... (you can specify a different query.
```

[}]: #

After we connect `subscribeToMore` to the component’s props, we attach a subscription property on the component (so there’s only one) which initializes `subscribeToMore` with the required parameters. Inside `updateQuery`, when we receive a new message, we make sure its not a duplicate, and then unshift the message onto our collection of messages.

Does it work?! ![Working Image](https://s3-us-west-1.amazonaws.com/tortilla/chatty/step6-13.gif)

We need to subscribe to new Groups and Messages so our Groups component will update in real time. The Groups component needs to subscribe to `groupAdded` and `messageAdded` because in addition to new groups popping up when they’re created, the latest messages should also show up in each group’s preview. 

However, instead of using `subscribeToMore` in our Groups screen, we should actually consider applying these subscriptions to a higher order component (HOC) for our application. If we navigate away from the Groups screen at any point, we will unsubscribe and won't receive real-time updates while we're away from the screen. We'd need to refetch queries from the network when returning to the Groups screen to guarantee that our data is up to date. 

If we attach our subscription to a higher order component, like `AppWithNavigationState`, we can stay subscribed to the subscriptions no matter where the user navigates and always keep our state up to date in real time! 

Let's apply the `USER_QUERY` to `AppWithNavigationState` in `client/src/navigation.js` and include two subscriptions using `subscribeToMore` for new `Messages` and `Groups`:

[{]: <helper> (diffStep 6.14)

#### Step 6.14: Apply subscribeToMore to AppWithNavigationState

##### Changed client&#x2F;src&#x2F;navigation.js
```diff
@@ -1,8 +1,11 @@
 ┊ 1┊ 1┊import PropTypes from 'prop-types';
-┊ 2┊  ┊import React from 'react';
+┊  ┊ 2┊import React, { Component } from 'react';
 ┊ 3┊ 3┊import { addNavigationHelpers, StackNavigator, TabNavigator } from 'react-navigation';
 ┊ 4┊ 4┊import { Text, View, StyleSheet } from 'react-native';
 ┊ 5┊ 5┊import { connect } from 'react-redux';
+┊  ┊ 6┊import { graphql, compose } from 'react-apollo';
+┊  ┊ 7┊import update from 'immutability-helper';
+┊  ┊ 8┊import { map } from 'lodash';
 ┊ 6┊ 9┊
 ┊ 7┊10┊import Groups from './screens/groups.screen';
 ┊ 8┊11┊import Messages from './screens/messages.screen';
```
```diff
@@ -10,6 +13,10 @@
 ┊10┊13┊import GroupDetails from './screens/group-details.screen';
 ┊11┊14┊import NewGroup from './screens/new-group.screen';
 ┊12┊15┊
+┊  ┊16┊import { USER_QUERY } from './graphql/user.query';
+┊  ┊17┊import MESSAGE_ADDED_SUBSCRIPTION from './graphql/message-added.subscription';
+┊  ┊18┊import GROUP_ADDED_SUBSCRIPTION from './graphql/group-added.subscription';
+┊  ┊19┊
 ┊13┊20┊const styles = StyleSheet.create({
 ┊14┊21┊  container: {
 ┊15┊22┊    flex: 1,
```
```diff
@@ -71,17 +78,109 @@
 ┊ 71┊ 78┊  return nextState || state;
 ┊ 72┊ 79┊};
 ┊ 73┊ 80┊
-┊ 74┊   ┊const AppWithNavigationState = ({ dispatch, nav }) => (
-┊ 75┊   ┊  <AppNavigator navigation={addNavigationHelpers({ dispatch, state: nav })} />
-┊ 76┊   ┊);
+┊   ┊ 81┊class AppWithNavigationState extends Component {
+┊   ┊ 82┊  componentWillReceiveProps(nextProps) {
+┊   ┊ 83┊    if (!nextProps.user) {
+┊   ┊ 84┊      if (this.groupSubscription) {
+┊   ┊ 85┊        this.groupSubscription();
+┊   ┊ 86┊      }
+┊   ┊ 87┊
+┊   ┊ 88┊      if (this.messagesSubscription) {
+┊   ┊ 89┊        this.messagesSubscription();
+┊   ┊ 90┊      }
+┊   ┊ 91┊    }
+┊   ┊ 92┊
+┊   ┊ 93┊    if (nextProps.user &&
+┊   ┊ 94┊      (!this.props.user || nextProps.user.groups.length !== this.props.user.groups.length)) {
+┊   ┊ 95┊      // unsubscribe from old
+┊   ┊ 96┊
+┊   ┊ 97┊      if (typeof this.messagesSubscription === 'function') {
+┊   ┊ 98┊        this.messagesSubscription();
+┊   ┊ 99┊      }
+┊   ┊100┊      // subscribe to new
+┊   ┊101┊      if (nextProps.user.groups.length) {
+┊   ┊102┊        this.messagesSubscription = nextProps.subscribeToMessages();
+┊   ┊103┊      }
+┊   ┊104┊    }
+┊   ┊105┊
+┊   ┊106┊    if (!this.groupSubscription && nextProps.user) {
+┊   ┊107┊      this.groupSubscription = nextProps.subscribeToGroups();
+┊   ┊108┊    }
+┊   ┊109┊  }
+┊   ┊110┊
+┊   ┊111┊  render() {
+┊   ┊112┊    const { dispatch, nav } = this.props;
+┊   ┊113┊    return <AppNavigator navigation={addNavigationHelpers({ dispatch, state: nav })} />;
+┊   ┊114┊  }
+┊   ┊115┊}
 ┊ 77┊116┊
 ┊ 78┊117┊AppWithNavigationState.propTypes = {
 ┊ 79┊118┊  dispatch: PropTypes.func.isRequired,
 ┊ 80┊119┊  nav: PropTypes.object.isRequired,
+┊   ┊120┊  subscribeToGroups: PropTypes.func,
+┊   ┊121┊  subscribeToMessages: PropTypes.func,
+┊   ┊122┊  user: PropTypes.shape({
+┊   ┊123┊    id: PropTypes.number.isRequired,
+┊   ┊124┊    email: PropTypes.string.isRequired,
+┊   ┊125┊    groups: PropTypes.arrayOf(
+┊   ┊126┊      PropTypes.shape({
+┊   ┊127┊        id: PropTypes.number.isRequired,
+┊   ┊128┊        name: PropTypes.string.isRequired,
+┊   ┊129┊      }),
+┊   ┊130┊    ),
+┊   ┊131┊  }),
 ┊ 81┊132┊};
 ┊ 82┊133┊
 ┊ 83┊134┊const mapStateToProps = state => ({
 ┊ 84┊135┊  nav: state.nav,
 ┊ 85┊136┊});
 ┊ 86┊137┊
-┊ 87┊   ┊export default connect(mapStateToProps)(AppWithNavigationState);
+┊   ┊138┊const userQuery = graphql(USER_QUERY, {
+┊   ┊139┊  options: () => ({ variables: { id: 1 } }), // fake the user for now
+┊   ┊140┊  props: ({ data: { loading, user, subscribeToMore } }) => ({
+┊   ┊141┊    loading,
+┊   ┊142┊    user,
+┊   ┊143┊    subscribeToMessages() {
+┊   ┊144┊      return subscribeToMore({
+┊   ┊145┊        document: MESSAGE_ADDED_SUBSCRIPTION,
+┊   ┊146┊        variables: { groupIds: map(user.groups, 'id') },
+┊   ┊147┊        updateQuery: (previousResult, { subscriptionData }) => {
+┊   ┊148┊          const previousGroups = previousResult.user.groups;
+┊   ┊149┊          const newMessage = subscriptionData.data.messageAdded;
+┊   ┊150┊
+┊   ┊151┊          const groupIndex = map(previousGroups, 'id').indexOf(newMessage.to.id);
+┊   ┊152┊
+┊   ┊153┊          return update(previousResult, {
+┊   ┊154┊            user: {
+┊   ┊155┊              groups: {
+┊   ┊156┊                [groupIndex]: {
+┊   ┊157┊                  messages: { $set: [newMessage] },
+┊   ┊158┊                },
+┊   ┊159┊              },
+┊   ┊160┊            },
+┊   ┊161┊          });
+┊   ┊162┊        },
+┊   ┊163┊      });
+┊   ┊164┊    },
+┊   ┊165┊    subscribeToGroups() {
+┊   ┊166┊      return subscribeToMore({
+┊   ┊167┊        document: GROUP_ADDED_SUBSCRIPTION,
+┊   ┊168┊        variables: { userId: user.id },
+┊   ┊169┊        updateQuery: (previousResult, { subscriptionData }) => {
+┊   ┊170┊          const newGroup = subscriptionData.data.groupAdded;
+┊   ┊171┊
+┊   ┊172┊          return update(previousResult, {
+┊   ┊173┊            user: {
+┊   ┊174┊              groups: { $push: [newGroup] },
+┊   ┊175┊            },
+┊   ┊176┊          });
+┊   ┊177┊        },
+┊   ┊178┊      });
+┊   ┊179┊    },
+┊   ┊180┊  }),
+┊   ┊181┊});
+┊   ┊182┊
+┊   ┊183┊export default compose(
+┊   ┊184┊  connect(mapStateToProps),
+┊   ┊185┊  userQuery,
+┊   ┊186┊)(AppWithNavigationState);
```

##### Changed client&#x2F;src&#x2F;screens&#x2F;groups.screen.js
```diff
@@ -186,7 +186,7 @@
 ┊186┊186┊    const { loading, user, networkStatus } = this.props;
 ┊187┊187┊
 ┊188┊188┊    // render loading placeholder while we fetch messages
-┊189┊   ┊    if (loading) {
+┊   ┊189┊    if (loading || !user) {
 ┊190┊190┊      return (
 ┊191┊191┊        <View style={[styles.loading, styles.container]}>
 ┊192┊192┊          <ActivityIndicator />
```

[}]: #

We have to do a little extra work to guarantee that our `messageSubscription` updates when we add or remove new groups. Otherwise, if a new group is created and someone sends a message, the user won’t be subscribed to receive that new message. When we need to update the subscription, we unsubscribe by calling the subscription as a function `messageSubscription()` and then reset `messageSubscription` to reflect the latest `nextProps.subscribeToMessages`.

One of the cooler things about Apollo is it caches all the queries and data that we've fetched and reuses data for the same query in the future instead of requesting it from the network (unless we specify otherwise). `USER_QUERY` will  make a request to the network and then data will be reused for subsequent executions. Our app setup tracks any data changes with subscriptions, so we only end up requesting the data we need from the server once!

## Handling broken connections
We need to do one more step to make sure our app stays updated in real-time. Sometimes users will lose internet connectivity or the WebSocket might disconnect temporarily. During these blackout periods, our client won't receive any subscription events, so our app won't receive new messages or groups. `subscriptions-transport-ws` has a built-in reconnecting mechanism, but it won't track any missed subscription events.

The simplest way to handle this issue is to refetch all relevant queries when our app reconnects. `wsClient` exposes an `onReconnected` function that will call the supplied callback function when the WebSocket reconnects. We can simply call `refetch` on our queries in the callback.

[{]: <helper> (diffStep 6.15)

#### Step 6.15: Apply onReconnected to refetch missed subscription events

##### Changed client&#x2F;src&#x2F;app.js
```diff
@@ -11,7 +11,7 @@
 ┊11┊11┊const networkInterface = createNetworkInterface({ uri: 'http://localhost:8080/graphql' });
 ┊12┊12┊
 ┊13┊13┊// Create WebSocket client
-┊14┊  ┊const wsClient = new SubscriptionClient('ws://localhost:8080/subscriptions', {
+┊  ┊14┊export const wsClient = new SubscriptionClient('ws://localhost:8080/subscriptions', {
 ┊15┊15┊  reconnect: true,
 ┊16┊16┊  connectionParams: {
 ┊17┊17┊    // Pass any arguments you want for initialization
```

##### Changed client&#x2F;src&#x2F;navigation.js
```diff
@@ -17,6 +17,8 @@
 ┊17┊17┊import MESSAGE_ADDED_SUBSCRIPTION from './graphql/message-added.subscription';
 ┊18┊18┊import GROUP_ADDED_SUBSCRIPTION from './graphql/group-added.subscription';
 ┊19┊19┊
+┊  ┊20┊import { wsClient } from './app';
+┊  ┊21┊
 ┊20┊22┊const styles = StyleSheet.create({
 ┊21┊23┊  container: {
 ┊22┊24┊    flex: 1,
```
```diff
@@ -88,6 +90,15 @@
 ┊ 88┊ 90┊      if (this.messagesSubscription) {
 ┊ 89┊ 91┊        this.messagesSubscription();
 ┊ 90┊ 92┊      }
+┊   ┊ 93┊
+┊   ┊ 94┊      // clear the event subscription
+┊   ┊ 95┊      if (this.reconnected) {
+┊   ┊ 96┊        this.reconnected();
+┊   ┊ 97┊      }
+┊   ┊ 98┊    } else if (!this.reconnected) {
+┊   ┊ 99┊      this.reconnected = wsClient.onReconnected(() => {
+┊   ┊100┊        this.props.refetch(); // check for any data lost during disconnect
+┊   ┊101┊      }, this);
 ┊ 91┊102┊    }
 ┊ 92┊103┊
 ┊ 93┊104┊    if (nextProps.user &&
```
```diff
@@ -117,6 +128,7 @@
 ┊117┊128┊AppWithNavigationState.propTypes = {
 ┊118┊129┊  dispatch: PropTypes.func.isRequired,
 ┊119┊130┊  nav: PropTypes.object.isRequired,
+┊   ┊131┊  refetch: PropTypes.func,
 ┊120┊132┊  subscribeToGroups: PropTypes.func,
 ┊121┊133┊  subscribeToMessages: PropTypes.func,
 ┊122┊134┊  user: PropTypes.shape({
```
```diff
@@ -137,9 +149,10 @@
 ┊137┊149┊
 ┊138┊150┊const userQuery = graphql(USER_QUERY, {
 ┊139┊151┊  options: () => ({ variables: { id: 1 } }), // fake the user for now
-┊140┊   ┊  props: ({ data: { loading, user, subscribeToMore } }) => ({
+┊   ┊152┊  props: ({ data: { loading, user, refetch, subscribeToMore } }) => ({
 ┊141┊153┊    loading,
 ┊142┊154┊    user,
+┊   ┊155┊    refetch,
 ┊143┊156┊    subscribeToMessages() {
 ┊144┊157┊      return subscribeToMore({
 ┊145┊158┊        document: MESSAGE_ADDED_SUBSCRIPTION,
```

##### Changed client&#x2F;src&#x2F;screens&#x2F;messages.screen.js
```diff
@@ -16,6 +16,7 @@
 ┊16┊16┊import _ from 'lodash';
 ┊17┊17┊import moment from 'moment';
 ┊18┊18┊
+┊  ┊19┊import { wsClient } from '../app';
 ┊19┊20┊import Message from '../components/message.component';
 ┊20┊21┊import MessageInput from '../components/message-input.component';
 ┊21┊22┊import GROUP_QUERY from '../graphql/group.query';
```
```diff
@@ -127,9 +128,18 @@
 ┊127┊128┊        });
 ┊128┊129┊      }
 ┊129┊130┊
+┊   ┊131┊      if (!this.reconnected) {
+┊   ┊132┊        this.reconnected = wsClient.onReconnected(() => {
+┊   ┊133┊          this.props.refetch(); // check for any data lost during disconnect
+┊   ┊134┊        }, this);
+┊   ┊135┊      }
+┊   ┊136┊
 ┊130┊137┊      this.setState({
 ┊131┊138┊        usernameColors,
 ┊132┊139┊      });
+┊   ┊140┊    } else if (this.reconnected) {
+┊   ┊141┊      // remove event subscription
+┊   ┊142┊      this.reconnected();
 ┊133┊143┊    }
 ┊134┊144┊  }
 ┊135┊145┊
```
```diff
@@ -217,6 +227,7 @@
 ┊217┊227┊  }),
 ┊218┊228┊  loading: PropTypes.bool,
 ┊219┊229┊  loadMoreEntries: PropTypes.func,
+┊   ┊230┊  refetch: PropTypes.func,
 ┊220┊231┊  subscribeToMore: PropTypes.func,
 ┊221┊232┊};
 ┊222┊233┊
```
```diff
@@ -229,9 +240,10 @@
 ┊229┊240┊      limit: ITEMS_PER_PAGE,
 ┊230┊241┊    },
 ┊231┊242┊  }),
-┊232┊   ┊  props: ({ data: { fetchMore, loading, group, subscribeToMore } }) => ({
+┊   ┊243┊  props: ({ data: { fetchMore, loading, group, refetch, subscribeToMore } }) => ({
 ┊233┊244┊    loading,
 ┊234┊245┊    group,
+┊   ┊246┊    refetch,
 ┊235┊247┊    subscribeToMore,
 ┊236┊248┊    loadMoreEntries() {
 ┊237┊249┊      return fetchMore({
```

[}]: #

Final product: ![Final Image](https://s3-us-west-1.amazonaws.com/tortilla/chatty/step6-14.gif)
[{]: <helper> (navStep)

| [< Previous Step](step10.md) |
|:----------------------|

[}]: #
