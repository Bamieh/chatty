import GraphQLDate from 'graphql-date';
import { withFilter } from 'graphql-subscriptions';
import { map } from 'lodash';

import { Group, Message, User } from './connectors';
import { pubsub } from '../subscriptions';

const MESSAGE_ADDED_TOPIC = 'messageAdded';
const GROUP_ADDED_TOPIC = 'groupAdded';

export const Resolvers = {
  Date: GraphQLDate,
  Query: {
    group(_, args) {
      return Group.find({ where: args });
    },
    messages(_, args) {
      return Message.findAll({
        where: args,
        order: [['createdAt', 'DESC']],
      });
    },
    user(_, args) {
      return User.findOne({ where: args });
    },
  },
  Mutation: {
    createMessage(_, { text, userId, groupId }) {
      return Message.create({
        userId,
        text,
        groupId,
      }).then((message) => {
        // publish subscription notification with the whole message
        pubsub.publish(MESSAGE_ADDED_TOPIC, { [MESSAGE_ADDED_TOPIC]: message });
        return message;
      });
    },
    createGroup(_, { name, userIds, userId }) {
      return User.findOne({ where: { id: userId } })
        .then(user => user.getFriends({ where: { id: { $in: userIds } } })
          .then(friends => Group.create({
            name,
            users: [user, ...friends],
          })
            .then(group => group.addUsers([user, ...friends])
              .then((res) => {
                // append the user list to the group object
                // to pass to pubsub so we can check members
                group.users = [user, ...friends];
                pubsub.publish(GROUP_ADDED_TOPIC, { [GROUP_ADDED_TOPIC]: group });
                return group;
              })),
          ),
        );
    },
    deleteGroup(_, { id }) {
      return Group.find({ where: id })
        .then(group => group.getUsers()
          .then(users => group.removeUsers(users))
          .then(() => Message.destroy({ where: { groupId: group.id } }))
          .then(() => group.destroy()),
        );
    },
    leaveGroup(_, { id, userId }) {
      return Group.findOne({ where: { id } })
        .then(group => group.removeUser(userId)
          .then(() => group.getUsers())
          .then((users) => {
            // if the last user is leaving, remove the group
            if (!users.length) {
              group.destroy();
            }
            return { id };
          }),
        );
    },
    updateGroup(_, { id, name }) {
      return Group.findOne({ where: { id } })
        .then(group => group.update({ name }));
    },
  },
  Subscription: {
    messageAdded: {
      subscribe: withFilter(
        () => pubsub.asyncIterator(MESSAGE_ADDED_TOPIC),
        (payload, args) => {
          return Boolean(
            args.groupIds &&
            ~args.groupIds.indexOf(payload.messageAdded.groupId) &&
            args.userId !== payload.messageAdded.userId, // don't send to user creating message
          );
        },
      ),
    },
    groupAdded: {
      subscribe: withFilter(
        () => pubsub.asyncIterator(GROUP_ADDED_TOPIC),
        (payload, args) => {
          return Boolean(
            args.userId &&
            ~map(payload.groupAdded.users, 'id').indexOf(args.userId) &&
            args.userId !== payload.groupAdded.users[0].id, // don't send to user creating group
          );
        },
      ),
    },
  },
  Group: {
    users(group) {
      return group.getUsers();
    },
    messages(group, args) {
      return Message.findAll({
        where: { groupId: group.id },
        order: [['createdAt', 'DESC']],
        limit: args.limit,
        offset: args.offset,
      });
    },
  },
  Message: {
    to(message) {
      return message.getGroup();
    },
    from(message) {
      return message.getUser();
    },
  },
  User: {
    messages(user) {
      return Message.findAll({
        where: { userId: user.id },
        order: [['createdAt', 'DESC']],
      });
    },
    groups(user) {
      return user.getGroups();
    },
    friends(user) {
      return user.getFriends();
    },
  },
};

export default Resolvers;
