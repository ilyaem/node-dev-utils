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
    options = Object.assign({
        hosts: null,
        templates: './views/',
        staticTemplates: true,
        notfound: '',
        staticAlias: '/static/', // url part
        staticPath: './static/', // fs path
        index: 'index',
        templateExt: '.html',
        resourceCallback: null,
        maxBody: MAX_BODY,
        auth: { username:null, password:null },
        errors: { 404:null, 500:null }
    }, options);
    
    var mimeTypes = {
        text: {
            '.html': 'text/html',
            '.js': 'application/javascript',
            '.css': 'text/css'
        },
        binary: {
            '.png': 'image/png',
            '.ico': 'image/x-icon',
            '.svg': 'image/svg+xml'
        }
    };
    var getContentType = function(extension) {
        if(extension && mimeTypes.binary[extension]) {
            return mimeTypes.binary[extension];
        } else {
            return (mimeTypes.text[extension] || 'text/plain') + '; charset=utf-8';
        }
    };
    
    var readTemplate = function(template, success, error) {
        try {
            if(options.staticTemplates) {
                require('fs').readFile(options.templates + template + options.templateExt, function(err, data) {
                    err ? error(err) : success(data);
                });
            } else {
                var compiled = require(options.templates + template + options.templateExt);
                success(compiled);
            }
        } catch(err) {
            if(options.notfound) {
                readTemplate(options.notfound, success, error);
            } else {
                error(err);
            }
        }
    };
    var readStatic = function(path, success, error, absPath) {
        require('fs').readFile((absPath ? options.templates : options.staticPath) + path, function(err, data) {
            err ? error(err) : success(data);
        });
    };
    var respond = function(res, data, status, extension) {
        if(status !== 200) {
            var value = options.errors[status];
            if(typeof(value) === 'function') value = value(status, data);
            if(value !== null) data = value;
        }
        
        res.writeHead(status || 200, !data ? null : {
            'Content-Length': data.length,
            'Content-Type': getContentType(extension)
        });
        res.end(data);
    };
    
    var that = this;
    
    return function(req, res) {
        var hostPath = options.hosts[req.headers.host];
        if(options.hosts && hostPath === undefined) {
            res.statusCode = 500;
            res.end();
            return;
        }
        
        if(options.auth.username && !that.basicAuth(req, res, options.auth.username, options.auth.password)) {
            return;
        }
        
        var urlPath = path.normalize(hostPath + req.url);
        if(urlPath.indexOf(options.staticAlias) === 0 || urlPath === '/favicon.ico') {
            var extension = urlPath.match(/\.[a-z]+$/);
            urlPath = urlPath.substr(options.staticAlias.length);
            readStatic(urlPath, function success(data) {
                respond(res, data, 200, extension);
            }, function error() {
                res.writeHead(404);
                res.end();
            });
            
        } else {
            req.cookies = that.parseCookies(req);
            res.readTemplate = readTemplate;
            res.readStatic = readStatic;
            res.respond = respond.bind(this, res);
            res.render = function(template, parsedUrl, postData, extension) {
                if(extension != options.templateExt) {
                    readStatic(template + extension, function success(data) {
                        respond(res, data, 200, extension);
                    }, function error() {
                        res.writeHead(404);
                        res.end();
                    }, true);
                } else {
                    readTemplate(template, function success(compiled) {
                        var data;
                        if(options.staticTemplates) {
                            data = compiled;
                        } else {
                            try {
                                data = compiled.render(Object.assign(params, parsedUrl.query || {}));
                            } catch(err) {
                                data = 'Render error: ' + err.message;
                            }
                        }
                        respond(res, data, 200, options.templateExt);
                        
                    }, function error(err) {
                        respond(res, 'Render error: ' + err.message, 404);
                    });
                }
            };
            
            that.processPost(req, function(err, postData) {
                if(err) {
                    respond(res, 'Error', err === 413 ? 413 : 500);
                    return;
                }
                
                var parsedUrl = url.parse(req.url, true);
                
                if(options.resourceCallback) {
                    options.resourceCallback(req, res, parsedUrl, postData);
                
                } else {
                    var template = urlPath || options.index;
                    var extension = options.templateExt;
                    var extPos = template.indexOf('.', template.length - 5);
                    if(extPos !== -1) {
                        extension = template.substring(extPos);
                        template = template.substring(0, extPos);
                    } else if(template[template.length - 1] === '/') {
                        template += options.index;
                    }
                    res.render(template, parsedUrl, postData, extension);
                }
            }, options);
        }
    };
};

exports.https = function(target, callback, options) {
    var that = this;
    options = options || {};
    options.maxBody = options.maxBody || MAX_BODY;
    
    var parsedUrl = url.parse(target);
    https.request({
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.host,
        path: parsedUrl.path || '/',
        method: options.method || 'GET'
    }, function(res) {
        that.processPost(res, callback, options);
        
    }).on('error', function(error) {
        callback(error, null, null);
    }).end();
};

exports.processPost = function(message, callback, options) {
    options = options || {};
    options.contentQuery = options.contentQuery || [ 'application/x-www-form-urlencoded', 'text/plain' ];
    options.contentJson = options.contentJson || [ 'application/json', 'text/javascript' ];
    
    var maxLength = message.headers['content-length'] || options.maxBody;
    if(maxLength > options.maxBody) {
        message.resume && message.resume();
        message.connection && message.connection.destroy();
        return callback(413, null);
    }
    
    var postData = '';
    message.on('data', function(chunk) {
        postData += chunk;
        if(postData.length > maxLength) {
            message.resume && message.resume();
            message.connection && message.connection.destroy();
        }
    });
    message.on('end', function() {
        var contentType = message.headers['content-type'];
        if(contentType && !options.preventContentParse) {
            contentType = contentType.split(';')[0];
            if(options.contentQuery.indexOf(contentType) !== -1) {
                postData = querystring.parse(postData);
                
            } else if(options.contentJson.indexOf(contentType) !== -1) {
                try {
                    postData = JSON.parse(postData);
                } catch(err) {}
            }
        }
        callback(null, postData);
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
};
