const   path = require('path'),
        url = require('url'),
        https = require('https'),
        querystring = require('querystring');

const MAX_BODY = 1e6;
const STATIC_PATHS = [
    '/favicon.ico',
    '/robots.txt'
];
const MIME_PLAIN_TEXT = 'text/plain';
const MIME_BINARY = 'application/octet-stream';
const MIME_ENCODED = 'application/x-www-form-urlencoded';
const MIME_JAVASCRIPT = 'application/javascript';
const MIME_JSON = 'application/json';
const MIME_TYPES = {
    '.txt': MIME_PLAIN_TEXT,
    '.html': 'text/html',
    '.js': MIME_JAVASCRIPT,
    '.css': 'text/css',
    '.xml': 'text/xml',
    '.json': MIME_JSON,
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml',
    '.ttf': 'font/truetype',
    '.otf': 'font/opentype',
    '.mp4': 'video/mp4',
    '.mp3': 'audio/mpeg',
    '.zip': 'application/zip'
};
const TEXT_FORMATS = [ '.txt','.html', '.js', '.css', '.xml', '.json' ];

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
    var that = this;
    
    options = Object.assign({
        hosts: null,
        auth: { username:null, password:null },
        errors: { 404:null, 500:null },
        resourceCallback: null,
        
        basePath: process.cwd(),
        templatesPath: '/views/', // fs path
        executable: [ '.js' ],
        executablePrefix: 'ctrl.', // only ctrl.file.js will execute
        index: [ 'index.html', 'index.js' ],
        notfound: '',
        
        staticUrl: '/static/', // url part
        staticPath: '/static/', // fs path
        
        maxBody: MAX_BODY,
        mimeTypes: MIME_TYPES,
        staticAliases: STATIC_PATHS
    }, options);
    
    options.index = (!options.index ? [] : (typeof(options.index) === 'string' ? [ options.index ] : options.index));
    
    var readTemplate = function(hostPath, filePath, fileName, success, error, forceStatic) {
        var isIndex = options.index.indexOf(fileName) + 1;
        var isNotfound = (fileName === options.notfound);
        
        var fileExt = path.extname(fileName);
        var isExecutable = (options.executable.indexOf(fileExt) !== -1) && !forceStatic;
        
        var fullPath = path.join(options.basePath, options.templatesPath, hostPath, filePath);
        fullPath = path.join(fullPath, (isExecutable ? options.executablePrefix : '') + fileName);
        var compiled;
        
        var failureCase = function() {
            if(isExecutable) {
                readTemplate(hostPath, filePath, fileName, success, error, true);
                
            } else if(isIndex && isIndex < options.index.length) {
                readTemplate(hostPath, filePath, options.index[isIndex], success, error);
                
            } else if(!isNotfound && options.notfound) {
                readTemplate(hostPath, filePath, options.notfound, success, error);
                
            } else {
                return false;
            }
            return true;
        };
        
        try {
            if(isExecutable) {
                compiled = require(fullPath);
                success(compiled, isExecutable);
                
            } else {
                compiled = require('fs').readFile(fullPath, function(err, data) {
                    err ? failureCase() || error(err, isExecutable) : success(data, isExecutable);
                });
            }
            
        } catch(err) {
            failureCase() || error(err, isExecutable);
        }
    };
    
    var readStatic = function(hostPath, filePath, fileName, success, error) {
        var fullPath = path.join(options.basePath, hostPath, options.staticPath, filePath, fileName);
        require('fs').readFile(fullPath, function(err, data) {
            err ? error(err) : success(data);
        });
    };
    
    var respond = function(res, data, status, isBinary, extension) {
        if(status !== 200) {
            var value = options.errors[status];
            if(typeof(value) === 'function') value = value(status, data);
            if(value !== null) data = value;
        }
        
        res.writeHead(status || 200, !data ? null : {
            'Content-Length': data.length,
            'Content-Type': that.getMimeType(extension, options.mimeTypes, isBinary, true)
        });
        res.end(data);
    };
    
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
        
        var parsedUrl = url.parse(req.url, true);
        var reqPath = parsedUrl.pathname || '/';
        
        var urlLastSlash = reqPath.lastIndexOf('/');
        
        var urlPath = reqPath.substr(0, urlLastSlash + 1) || '/';
        var urlName = reqPath.substr(urlLastSlash + 1);
        
        var isStaticResource = (urlPath.indexOf(options.staticUrl) === 0 || options.staticAliases.indexOf(urlPath) !== -1);
        
        if(isStaticResource) {
            urlPath = urlPath.substr(options.staticUrl.length);
            readStatic(hostPath, urlPath, urlName, function success(data) {
                respond(res, data, 200, true, path.extname(urlName));
            }, function error() {
                res.writeHead(404);
                res.end();
            });
            
        } else {
            req.cookies = that.parseCookies(req);
            res.readTemplate = readTemplate.bind(this, hostPath);
            res.readStatic = readStatic.bind(this, hostPath);
            res.respond = respond.bind(this, res);
            res.render = function(filePath, fileName, parsedUrl, postData) {
                readTemplate(hostPath, filePath, fileName, function success(compiled, isExecutable) {
                    var data;
                    if(!isExecutable) {
                        data = compiled;
                        
                    } else {
                        try {
                            data = compiled(Object.assign(params, parsedUrl.query || {}));
                        } catch(err) {
                            data = 'Render error: ' + err.message;
                        }
                    }
                    respond(res, data, 200, false, path.extname(fileName));
                    
                }, function error(err) {
                    respond(res, 'Render error: ' + err.message, 404);
                });
            };
            
            that.processPost(req, function(err, postData) {
                if(err) {
                    respond(res, 'Error', err === 413 ? 413 : 500);
                    return;
                }
                
                if(options.resourceCallback) {
                    var result = options.resourceCallback(req, res, parsedUrl, postData);
                    if(result) return;
                }
                
                res.render(urlPath, urlName || options.index[0], parsedUrl, postData);
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
    options.contentQuery = options.contentQuery || [ MIME_ENCODED, MIME_PLAIN_TEXT ];
    options.contentJson = options.contentJson || [ MIME_JSON, MIME_JAVASCRIPT ];
    
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

exports.getMimeType = function(extension, mimeTypes, isBinary, addCharset) {
    var mimeType;
    var isTrueBinary;
    
    if(extension) {
        mimeType = mimeTypes[extension];
        isTrueBinary = mimeType ? TEXT_FORMATS.indexOf(extension) === -1 : isBinary;
        mimeType = mimeType || (isTrueBinary ? MIME_BINARY : MIME_PLAIN_TEXT);
    } else {
        mimeType = isBinary ? MIME_BINARY : MIME_PLAIN_TEXT;
    }
    
    return mimeType + (addCharset && !isTrueBinary ? '; charset=utf-8' : '');
};
