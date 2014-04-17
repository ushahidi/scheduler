var config = require('config')
  , logger = require('winston')
  , kue = require('kue')
  , _ = require("underscore")
  , moment = require('moment')
  , redis = require('redis')
  , RedisQueue = require("simple-redis-queue")
  , mongoose = require('mongoose')
  , EventEmitter = require('events').EventEmitter
  , store = require("./modules/cn-store-js")
  , async = require('async');


var findActiveSources = function(callback) {
  store.Source.findActive(function(err, sources) {
    if(err) return logger.error("Error getting active sources");

    if(_(sources).isEmpty()) {
      logger.warn("no sources found");
      return false;
    }

    callback(err, sources);
    
  });
};


var repeatQueueCreate = function(source, repeatDelay, callback) {
  repeatQueueClient.create(source.id, {source:source})
    .delay(repeatDelay)
    .save(function(err, state) {
      logger.info("new task created for " + source.id);
      if(typeof callback === 'function') {
        callback(err, state);
      }
    });
};


var setupProcess = function(sources) {
  _(sources).each(function(source) {
    repeatQueueClient.process(source.id, function(task, done) {
      logger.info("processing task for "+source.id);
      redisQueueClient.push("suckjs", {id:source.id});
      done();

      if(source.frequency === "repeats") {
        var repeatDelay = source.repeatMilliseconds();
        repeatQueueCreate(source, repeatDelay);
      }

    });
  });
};


var checkShouldSuck = function(source, callback) {
  if(source.frequency === "once" && source.hasRun === false) {
    callback(true);
  }
  else if(source.frequency === "repeats") {
    // If we don't have any scheduled tasks, suck it
    kue.Job.rangeByType(source.id,'delayed', 0, 10, '', function (err, jobs) {
        if (jobs.length) {
          callback(false);
        }
        else {
          callback(true);
        }
    });
  }
  else {
    callback(false)
  }
};


var runApp = function() {
  findActiveSources(function(err, sources) {
    if(err) return logger.error("Error getting active sources");
    setupProcess(sources);

    _(sources).each(function(source) {
      checkShouldSuck(source, function(shouldSuck) {
        if(shouldSuck) {
          repeatQueueCreate(source, 1000);
        }
      });
    });
  });
};


if(require.main === module) {
  // Start kue web server on port 3000
  // @TODO secure this in production
  kue.app.listen(3000);

  var makeRedisClient = function() {
    var redisClient = redis.createClient(config.queue.port, config.queue.host);
    redisClient.auth(config.queue.password);
    return redisClient;
  }

  var redisQueueClient = new RedisQueue(makeRedisClient());

  kue.redis.createClient = makeRedisClient;

  var repeatQueueClient = kue.createQueue({
    redis: {
      port: config.queue.port,
      host: config.queue.host,
      auth: config.queue.password
    }
  });

  repeatQueueClient.promote();

  mongoose.connect(config.dbURI); 
  var db = mongoose.connection;
  
  db.on('error', function(err) { 
    if(err) logger.error('sucka.App.setupDB mongo connect error ' + err);
  });

  db.once('open', runApp);  
}