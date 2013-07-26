(function() {
	var loader = (function() {
		var modules = {};
		var cache = {};

		var dummy = function() {
			return function() {
			};
		};
		var initModule = function(name, definition) {
			var module = {
				id : name,
				exports : {}
			};
			definition(module.exports, dummy(), module);
			var exports = cache[name] = module.exports;
			return exports;
		};

		var loader = function(path) {
			if (cache.hasOwnProperty(path))
				return cache[path];
			if (modules.hasOwnProperty(path))
				return initModule(path, modules[path]);
			throw new Error('Cannot find module "' + name + '"');
		};

		loader.register = function(bundle, fn) {
			modules[bundle] = fn;
		};
		return loader;
	})();

	// The connector module
	loader.register('realtime/connector', function(e, r, module) {
		var $ = loader('jquery'), JSON = loader('json2');

		module.exports = {
			/**
			 * Connector state.
			 *  - 0 = Disconnected - 1 = Connecting - 2 = Connected
			 */
			state : 0,
			webSocket : null,

			resolveContext : null,
			defered : null,
			
			messageDefereds: {},

			listeners : [],

			/**
			 * Is the connector connected to the WebSocket server ?
			 * 
			 * @return boolean
			 */
			isConnected : function() {
				return this.state == 2;
			},

			/**
			 * Try to connect to the given WebSocket server.
			 * 
			 * @param string
			 *            WS server path, which might looks like
			 *            "ws://host:port/path"
			 * @return defered
			 */
			connect : function(wsPath, context) {
				if (this.state == 1) {
					return this.defered.promise();
				} else if (this.isConnected()) {
					var dfd = $.Deferred();
					dfd.resolveWith(context);
					return dfd.promise();
				}

				this.resolveContext = context;
				this.defered = $.Deferred();
				this.state = 1;

				// Create the WebSocket
				this.webSocket = new WebSocket(wsPath);
				this.webSocket.onopen = $.proxy(this.onOpen, this);
				this.webSocket.onmessage = $.proxy(this.onMessage, this);
				this.webSocket.onclose = $.proxy(this.onClose, this);
				this.webSocket.onerror = $.proxy(this.onError, this);

				return this.defered.promise();
			},

			onOpen : function() {
				this.state = 2;

				// Send the connection message
				this.send(this.createConnectionMessage());

				if (this.defered != null) {
					this.defered.resolveWith(this.resolveContext);
					this.defered = null;
				}
			},

			onError : function(error) {
				this.state = 0;
				this.rejectDeferreds("Unable to communication with WebSocket");
			},

			onMessage : function(event) {
				var message = JSON.parse(event.data);
				
				// Check for conversationUid
				var conversationUid = message.conversationUid;
				if (conversationUid != undefined && this.messageDefereds[conversationUid] != undefined) {
					this.messageDefereds[conversationUid].resolve([message]);
					
					return;
				}

				// Dispatch message to listeners
				for ( var i = 0; i < this.listeners.length; i++) {
					var item = this.listeners[i];

					item.listener.apply(item.context, [message]);
				}
			},

			onClose : function() {
				this.state = 0;
				this.rejectDeferreds("Connection closed");
			},
			
			rejectDeferreds: function (message)
			{
				if (this.defered != null) {
					this.defered.rejectWith(this.resolveContext, [message]);
					this.defered = null;
				}
				for (var key in this.messageDefereds) {
					this.messageDefereds[key].reject([message]);
				}
			},

			send : function (message) {
				// Generate a conversationUid
				var conversationUid = this.randomUid();
				message.conversationUid = conversationUid;
				
				// Create the defered object
				this.messageDefereds[conversationUid] = $.Deferred();

				this.webSocket.send(JSON.stringify(message));
				
				return this.messageDefereds[conversationUid].promise();
			},

			addListener : function(listener, context) {
				this.listeners.push({
					listener : listener,
					context : context
				});
			},

			createConnectionMessage : function() {
				return {
					'type' : 'realtime-connect',
					'data' : {
						'userAgent' : navigator.userAgent
					}
				}
			},

			randomUid: function() {
				return Math.floor((1 + Math.random()) * 0x10000).toString(16)
						.substring(1);
			}
		};
	});

	// The Synchronizer module
	loader
			.register(
					'realtime/synchronizer',
					function(e, r, module) {
						var connector = loader('realtime/connector'),
							$ = loader('jquery');

						var Synchronizer = module.exports = {
							register : function(model) {
								// Override the sync method of the model
								// (whatever model
								// or collection) to pass by websocket
								model.sync = this.sync;
							},

							/**
							 * The sync method that will replace the original
							 * Backbone sync.
							 * 
							 */
							sync : function(method, model, options) {
								if (!model.realtimeIdentifier) {
									throw new Error(
											'A "realtimeIdentifier" property must be specified');
								}

								// Create the message object
								message = {
									'type' : model.realtimeIdentifier + ':'
											+ method
								}

								// Add the object data
								if (method === 'read') {
									if (!model.get("id")) {
										throw new Error(
												'A "id" attribute must be specified for read')
									}

									message.data = {
										'id' : model.get("id")
									};
								} else {
									message.data = model.attributes;
								}
								
								// Create the defered
								var dfd = $.Deferred(), context = this;

								// Send message
								connector.send(message).done(function(message){
									var resp = message.data;
									
									if (options.success) {
										options.success(resp);
									}
									
									dfd.resolveWith(context, [resp]);
								}).fail(function(message){
									if (options.error) {
										options.error(message);
									}
									dfd.rejectWith(context, [message]);
								});
								
								return dfd.promise();
							},

							/**
							 * Called by Connector when a message is received.
							 * 
							 */
							messageListener : function(message) {
								console.log('Synch recv: ' + message.type);
							}
						};

						// Add connector listener
						connector.addListener(Synchronizer.messageListener,
								this);
					});

	loader.register('realtime', function(e, r, module) {

		module.exports = {
			Connector : loader('realtime/connector'),
			Synchronizer : loader('realtime/synchronizer')
		};

	});

	var regDeps = function(jQuery, JSON) {
		loader.register('jquery', function(exports, require, module) {
			module.exports = jQuery;
		});
		loader.register('json2', function(exports, require, module) {
			module.exports = JSON;
		});
	};

	if (typeof define === 'function' && define.amd) {
		define([ 'jquery', 'json2' ], function(jQuery, JSON) {
			regDeps(jQuery, JSON);

			return loader('realtime');
		});
	} else if (typeof module === 'object' && module && module.exports) {
		regDeps(require('jquery'), require('json2'));

		module.exports = loader('realtime');
	} else {
		regDeps(window.jQuery, window.JSON);

		window.Backbone.Realtime = loader('realtime');
	}
}).call(this);