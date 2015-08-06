/*
 * Copyright (c) 2015 Francisco Salavert (DCG-CIPF)
 *
 * This file is part of JS Common Libs.
 *
 * JS Common Libs is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * JS Common Libs is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with JS Common Libs. If not, see <http://www.gnu.org/licenses/>.
 */

function FeatureTemplateAdapter(args) {

    _.extend(this, Backbone.Events);

    _.extend(this, args);

    this.on(this.handlers);

    this.configureCache();

    this.debug = false;
}

FeatureTemplateAdapter.prototype = {
    setSpecies: function (species) {
        this.species = species;
        this.configureCache();
    },
    setHost: function (host) {
        this.configureCache();
        this.host = host;
    },
    configureCache: function () {
        var cacheId = this.uriTemplate + (this.species.text + this.species.assembly).replace(/[/_().\ -]/g, '');
        if (!this.cacheConfig) {
            this.cacheConfig = {
                //    //subCacheId: this.resource + this.params.keys(),
                chunkSize: 3000
            }
        }
        this.cacheConfig.cacheId = cacheId;
        this.cache = new FeatureChunkCache(this.cacheConfig);
    },

    getData: function (args) {
        var _this = this;

        var params = {};
        //histogram: (dataType == 'histogram')
        _.extend(params, this.params);
        _.extend(params, args.params);

        /** 1 region check **/
        var region = args.region;
        if (region.start > 300000000 || region.end < 1) {
            return;
        }
        region.start = (region.start < 1) ? 1 : region.start;
        region.end = (region.end > 300000000) ? 300000000 : region.end;

        /** 2 category check **/
        var categories = [Utils.queryString(this.templateVariables) + Utils.queryString(params)];

        /** 3 dataType check **/
        var dataType = args.dataType;
        if (_.isUndefined(dataType)) {
            console.log("dataType must be provided!!!");
        }

        /** 4 chunkSize check **/
        var chunkSize = params.interval ? params.interval : this.cacheConfig.chunkSize; // this.cache.defaultChunkSize should be the same
        if (this.debug) {
            console.log(chunkSize);
        }

        /**
         * Get the uncached regions (uncachedRegions) and cached chunks (cachedChunks).
         * Uncached regions will be used to query cellbase. The response data will be converted in chunks
         * by the Cache TODO????
         * Cached chunks will be returned by the args.dataReady Callback.
         */
        this.cache.get(region, categories, dataType, chunkSize, function (cachedChunks, uncachedRegions) {

            var category = categories[0];
            var categoriesName = "";
            for (var j = 0; j < categories.length; j++) {
                categoriesName += "," + categories[j];
            }
            categoriesName = categoriesName.slice(1);   // to remove first ','

            var chunks = cachedChunks[category];
            // TODO check how to manage multiple regions
            var queriesList = _this._groupQueries(uncachedRegions[category]);

            /** Uncached regions found **/
            if (queriesList.length > 0) {
                args.webServiceCallCount = 0;
                for (var i = 0; i < queriesList.length; i++) {
                    args.webServiceCallCount++;
                    var queryRegion = queriesList[i];


                    var request = new XMLHttpRequest();

                    /** Temporal fix **/
                    request._qr = queryRegion;

                    request.onload = function () {
                        var response;
                        var contentType = this.getResponseHeader('Content-Type');
                        if (contentType === 'application/json') {
                            response = JSON.parse(this.response);
                        } else {
                            response = this.response;
                        }

                        /** Process response **/
                        var responseChunks = _this._success(response, categories, dataType, this._qr, chunkSize);
                        args.webServiceCallCount--;

                        chunks = chunks.concat(responseChunks);
                        if (args.webServiceCallCount === 0) {
                            chunks.sort(function (a, b) {
                                return a.chunkKey.localeCompare(b.chunkKey)
                            });
                            args.done({
                                items: chunks, dataType: dataType, chunkSize: chunkSize, sender: _this
                            });
                        }
                    };
                    request.onerror = function () {
                        console.log('Server error');
                        args.done();
                    };
                    var uriTemplate = new URITemplate(_this.uriTemplate);
                    var templateVariables = {
                        region: queryRegion.toString(),
                        species: Utils.getSpeciesCode(_this.species.text)
                    };
                    _.extend(templateVariables, _this.templateVariables);
                    var url = uriTemplate.expand(templateVariables);
                    url = Utils.addQueryParamtersToUrl(params, url);
                    request.open('GET', url, true);
                    console.log(url);
                    request.send();


                }
            } else
            /** All regions are cached **/
            {
                args.done({
                    items: chunks, dataType: dataType, chunkSize: chunkSize, sender: _this
                });
            }
        });
    },

    _success: function (data, categories, dataType, queryRegion, chunkSize) {
        var timeId = Utils.randomString(4) + this.resource + " save";
        console.time(timeId);
        /** time log **/

        var regions = [];
        var regionSplit = queryRegion.split(',');
        for (var i = 0; i < regionSplit.length; i++) {
            var regionStr = regionSplit[i];
            var region = new Region(regionStr);
            regions.push(region);
        }
        var chunks = this.parse(data);

        var items = this.cache.putByRegions(regions, chunks, categories, dataType, chunkSize);

        /** time log **/
        console.timeEnd(timeId);

        return items;
    },

    /**
     * Transform the list on a list of lists, to limit the queries
     * [ r1,r2,r3,r4,r5,r6,r7,r8 ]
     * [ [r1,r2,r3,r4], [r5,r6,r7,r8] ]
     */
    _groupQueries: function (uncachedRegions) {
        var groupSize = 50;
        var queriesLists = [];
        while (uncachedRegions.length > 0) {
            queriesLists.push(uncachedRegions.splice(0, groupSize).toString());
        }
        return queriesLists;
    },


};

