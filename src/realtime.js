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
			 * 
			 * - 0 = Disconnected
			 * - 1 = Connecting
			 * - 2 = Connected
			 */
			state: 0,
			webSocket: null,

			resolveContext: null,
			defered: null,
			
			/**
			 * Is the connector connected to the WebSocket server ?
			 * 
			 * @return boolean
			 */
			isConnected : function() 
			{
				return this.state == 2;
			},
			
			/**
			 * Try to connect to the given WebSocket server.
			 * 
			 * @param string WS server path, which might looks like
			 * 				 "ws://host:port/path"
			 * @return defered
			 */
			connect: function (wsPath, context) 
			{
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
				
				// Send the connection message
				//this.webSocket.send(this.createConnectionMessage());
				
				return this.defered.promise();
			},
			
			onOpen: function ()
			{
				console.log('onOpen ('+this.defered+')');
				this.state = 2;
				
				if (this.defered != null) {
					this.defered.resolveWith(this.resolveContext);
					this.defered = null;
				}
			},
			
			onError: function (error)
			{
				this.state = 0;
				
				if (this.defered != null) {
					this.defered.rejectWith(this.resolveContext, ["Unable to connect to WebSocket"]);
					this.defered = null;
				}
			},
			
			onMessage: function (event)
			{
				var message = JSON.parse(event.data)
				console.log('Received: '+event.data);
			},
			
			onClose: function ()
			{
				this.state = 0;
				
				if (this.defered != null) {
					this.defered.rejectWith(this.resolveContext);
					this.defered = null;
				}
			},
			
			createConnectionMessage: function ()
			{
				var message = {
					'type': 'realtime-connect',
					'data': {
						'userAgent': navigator.userAgent
					}
				};
				
				return JSON.stringify(message);
			}
		};
	});

	// The Synchronizer module
	loader.register('realtime/synchronizer', function(e, r, module) {
		module.exports = {
			register : function(model) {
				console.log('Model '+model+' is registered for sync');
			}
		};
	});

	loader.register('realtime', function(e, r, module) {

		module.exports = {
			Connector : loader('realtime/connector'),
			Synchronizer: loader('realtime/synchronizer')
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
		define(['jquery', 'json2'], function(jQuery, JSON) {
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