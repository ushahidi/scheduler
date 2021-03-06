var mongoose = require('mongoose')
  , validator = require('mongoose-validator')
  , validate = validator.validate
  , Promise = require('promise')
  , _ = require('underscore')
  , _s = require('underscore.string')
  , languageCodes = require('./language-codes')
  , schemaUtils = require("./utils")
  , logger = require("winston");


/**
 * Inside validator functions we have access to `this.str`. It's not always
 * clear what this will be, so you're advised to check for yourself with a 
 * handful of values (arrays, objects, etc).
 * 
 * The `isLanguage` validate verifies that the user has given us an ISO code 
 * that exists in the language codes known to our system. 
 */
validator.extend('isLanguage', function () {
    return _(_(languageCodes).pluck("code")).contains(this.str);
});

/**
 * An Item document represents a piece of data specific to a location. This can 
 * be either more ephemeral data, like a tweet or incident report, or more 
 * permanent, like the location of a police station or shelter.
 */
var itemSchema = mongoose.Schema({
    createdAt: {
      type: Date,
      default: Date.now
    },
    updatedAt: Date,
    /*
     * The date/time at which this document was published at its original 
     * source. 
     */
    publishedAt: Date,
    /**
     * This is either provided explictly by the data source (like a tweet id), 
     * or must be generated by CrisisNET based on the third-party content. It 
     * ensures that we will recognize when we see the same data a second time, 
     * and can either discard or update our record, whichever is appropriate. 
     */
    remoteID: {
      type: String,
      required: true,
      index: true
    },
    /**
     * Optional field indicating how long this item should be considered 
     * active.
     */
    activeUntil: Date,
    /**
     * Serves as a way to filter incoming data into buckets that are most useful 
     * for API consumers. Temporary data sources might be tweets or Facebook 
     * updates, while semi-permanent might be the location of relief shelters 
     * or open grocery stores, and permanent would be the location of a 
     * permanent physical structure, like a police station.
     */
    lifespan: {
      type: String,
      required: true,
      validate: validate('isIn', ['temporary', 'semi-permanent', 'permanent']),
      default: 'temporary'
    },
    content: String,
    summary: String,
    /**
     * Fully-formed URL to publically available image.
     */
    image: {
      type: String,
      validate: validate('isUrl')
    },
    geo: {
      /**
       * Known address components.  
       */
      addressComponents: {
        formattedAddress: String,
        streetNumber: String,
        streetName: String,
        streetAddress: String,
        neighborhood: String,
        adminArea5: String, // city
        adminArea4: String, // county
        adminArea3: String, // state
        adminArea2: String, // region
        adminArea1: String, // country
        postalCode: String
      },
      /**
       * Note that coordinates should always been longitude, latitude
       */
      coords: { type: [Number], index: '2dsphere'},
      /**
       * How accurate are the coordinates? Defined as radius, in meters.
       */
      accuracy: Number,
      granularity: {
        type: String,
        validate: validate('isIn', [
          'exact', 
          'near-exact', 
          'admin5',
          'admin4',
          'admin3', 
          'admin2', 
          'admin1', 
          'estimated', 
          'unclear'
        ])
      },
      mentionedPlaces: [String],
      /**
       * Unlike address components above, these are clues to the location of 
       * the content.
       */
      locationIdentifiers: {
        authorLocationName: String,
        authorTimeZone: String
      }
    },
    /**
     * This is a flat tagging system to categorize item data. CrisisNET maintains
     * the list of allowed tags. 
     */
    tags: [
      {
        name: { 
          type: String, 
          index: true
        },
        confidence: {
          type: Number,
          required: true,
          default: 1.0
        }
      }
    ],
    /**
     * [ISO code](http://stackoverflow.com/a/20623472/2367526) of the primary 
     * language of the content. 
     */
    language: {
      code: {
        type: String
        //validate: validate({passIfEmpty: true}, 'isLanguage')
      },
      name: String,
      nativeName: String
    },
    /**
     * Reference to the Source document that led to this item being retrieved.
     */
    source: {
      type: String,
      index: true
    },
    license: {
      type: String,
      required: true,
      default: 'unknown',
      validate: validate('isIn', ['odbl', 'commercial', 'unknown'])
    },
    fromURL: {
      type: String,
      validate: validate('isUrl')
    }
});

// Copying common methods, because inheriting from a base schema that inherited 
// from `mongoose.Schema` was annoying.
schemaUtils.setCommonFuncs("statics", itemSchema);
schemaUtils.setCommonFuncs("methods", itemSchema);

itemSchema.pre("save",function(next, done) {
    var self = this;

    // Note timestamp of update
    self.updatedAt = Date.now();

    // If this is provided, we assume it to be the third-party publish date.
    self.publishedAt = self.publishedAt || self.createdAt;

    // Create a summary, unless whoever did the transforming beat us
    // to it. 
    self.summary = self.summary || _s.prune(self.content, 100);

    // Grab the entire language object for the provided code, assuming a code
    // was provided.
    if(!_(self.language).isEmpty() && self.language.code) {
      self.language = _(languageCodes).findWhere({code: self.language.code});
    }
    // Don't let any old crap in here. If we didn't get an ISO code, then 
    // there's nothing more to say. 
    else {
      self.language = null;
    }


    next();
});

itemSchema.pre('save', function (next) {
  var coords = this.geo.coords;
  
  if(_(coords).isNull()) {
    this.geo.coords = undefined;
  }

  if(this.isNew && Array.isArray(coords) && 0 === coords.length) {
    this.geo.coords = undefined;
  }

  next();
});

var Item = mongoose.model('Item', itemSchema);

module.exports = Item;