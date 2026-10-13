'use strict';

// Central repository registry so controllers/services import from one place.
module.exports = {
  users: require('./users'),
  categories: require('./categories'),
  pricing: require('./pricing'),
  submissions: require('./submissions'),
  lots: require('./lots'),
  listings: require('./listings'),
  orders: require('./orders'),
  notifications: require('./notifications'),
  audit: require('./audit'),
  movements: require('./movements'),
  auctions: require('./auctions'),
  auctionBids: require('./auctionBids'),
  auctionSettings: require('./auctionSettings'),
};
