var path = require('path'),
    url = require('url'),
    querystring = require('querystring');

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
        static: '/static/', // url part
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
            var reqData = '';
            req.on('data', function(data) {
                reqData += data;
                if(reqData.length > 1e6) {
                    reqData = '';
                    res.writeHead(413, { 'Content-Type':'text/plain' }).end();
                    req.connection.destroy();
                }
            });
    
            req.on('end', function() {
                var parsedUrl = url.parse(req.url, true);
                var urlParts = parsedUrl.pathname.split('/');
                var urlParams = parsedUrl.query || {};
                var postData = that.getPostData(req, reqData);
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

exports.getPostData = function(req, data) {
    var post;
    if(req.method === 'POST' && req.headers['Content-Type'] === 'x-www-form-urlencoded') {
        post = querystring.parse(data);
    }
    return post || {
        post: data
    };
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
