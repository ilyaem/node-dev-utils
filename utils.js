const   path = require('path'),
        url = require('url'),
        https = require('https'),
        querystring = require('querystring');

const MAX_BODY = 1e6;

exports.basicAuth = function(req, res, username, password) {
    var credentials = [];
    if(req.headers.authorization) {
        var authorization = new Buffer(req.headers.authorization.substr(6), 'base64').toString();
        credentials = authorization.split(':');
    }
    
    if(credentials[0] === username && credentials[1] === password) {
        return true;
    } else {
        res.statusCode = 401;
        res.setHeader('WWW-Authenticate', 'Basic realm=" Please enter credentials to proceed "');
        res.end('Access denied');
        return false;
    }
};

exports.hosting = function(options, params) {
    options = this.merge({
        templates: './views/',
        notfound: '',
        'static': '/static/', // url part
        staticPath: './static/', // fs path
        index: 'index',
        templateExt: '.dhx',
        resourceCallback: null
    }, options);
    
    var mimeTypes = {
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.png': 'image/png',
        '.ico': 'image/x-icon'
    };
    var readTemplate = function(template, success, error) {
        try {
            var compiled = require(options.templates + template + options.templateExt);
            success(compiled);
        } catch(err) {
            if(options.notfound) {
                readTemplate(options.notfound, success, error);
            } else {
                error(err);
            }
        }
    };
    var readStatic = function(path, success, error) {
        require('fs').readFile(options.staticPath + path, function(err, data) {
            err ? error(err) : success(data);
        });
    };
    
    var that = this;
    
    return function(req, res) {
        if(options.host && req.headers.host !== options.host) {
            res.statusCode = 500;
            res.end();
            return;
        }
        
        var urlPath = path.normalize(req.url);
        if(urlPath.indexOf(options.static) === 0 || urlPath === '/favicon.ico') {
            var extension = urlPath.match(/\.[a-z]+$/);
            urlPath = urlPath.substr(options.static.length);
            readStatic(urlPath, function success(data) {
                res.writeHead(200, {
                    'Content-Length': data.length,
                    'Content-Type': mimeTypes[extension] || 'text/plain'
                });
                res.end(data);
            }, function error() {
                res.writeHead(404);
                res.end();
            });
            
        } else {
            that.processPost(res, function(err, postData) {
                var parsedUrl = url.parse(req.url, true);
                var urlParts = parsedUrl.pathname.split('/');
                var urlParams = parsedUrl.query || {};
                var cookies = that.parseCookies(req);
                
                if(options.resourceCallback) {
                    options.resourceCallback(req, res, urlParts, urlParams, postData, cookies);
                
                } else {
                    var template = urlParts[1];
                    if(!template) template = options.index;
                    readTemplate(template, function success(compiled) {
                        var data;
                        try {
                            data = compiled.render(that.merge(params, urlParams));
                        } catch(err) {
                            data = 'Render error: ' + err.message;
                        }
                        res.writeHead(200, {
                            'Content-Length': data.length,
                            'Content-Type': 'text/html; charset=utf-8'
                        });
                        res.end(data);
                        
                    }, function error(err) {
                        var data = 'Render error: ' + err.message;
                        res.writeHead(404, {
                            'Content-Length': data.length,
                            'Content-Type': 'text/html; charset=utf-8'
                        });
                        res.end(data);
                    });
                }
            });
        }
    };
};

exports.https = function(target, callback, options) {
    var that = this;
    options = options || {};
    var parsedUrl = url.parse(target);
    https.request({
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.host,
        path: parsedUrl.path || '/',
        method: options.method || 'GET'
    }, function(res) {
        that.processPost(res, callback);
        
    }).on('error', function(error) {
        callback(error, null, null);
    }).end();
};

exports.processPost = function(res, callback) {
    var postData = '';
    var err = null;
    res.on('data', function(chunk) {
        postData += chunk;
        if(postData.length > MAX_BODY) {
            res.writeHead(413, { 'Content-Type':'text/plain' }).end();
            res.connection.destroy();
            err = new Error('Too long request');
        }
    });
    res.on('end', function() {
        var contentType = res.headers['content-type'].split(';')[0];
        if(contentType === 'x-www-form-urlencoded' || contentType === 'text/plain') {
            postData = querystring.parse(postData);
            
        } else if(contentType === 'application/json') {
            try {
                postData = JSON.parse(postData);
            } catch(err) {}
        }
        callback(err, postData, res);
    });
};

exports.parseCookies = function(req) {
    var list = {},
        cookies = req.headers.cookie;
    
    cookies && cookies.split(';').forEach(function( cookie ) {
        var parts = cookie.split('=');
        list[parts.shift().trim()] = decodeURI(parts.join('='));
    });
    
    return list;
}

exports.merge = function(objects) {
    var target = {};
    var args = Array.prototype.slice.call(arguments);
    for(var i in args) {
        for(var key in args[i]) target[key] = args[i][key];
    }
    return target;
};
