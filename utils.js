var path = require('path');

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
    var mimeTypes = {
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.png': 'image/png',
        '.ico': 'image/x-icon'
    };
    var readTemplate = function(template, success, error) {
        try {
            var compiled = require(options.templates + template);
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
        require('fs').readFile('.' + path, function(err, data) {
            err ? error(err) : success(data);
        });
    };
    
    return function(req, res) {
        var url = path.normalize(req.url);
        if(url.indexOf(options.static) === 0 || url === '/favicon.ico') {
            var extension = url.match(/\.[a-z]+$/);
            readStatic(url, function success(data) {
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
            var template = url.split('/')[1];
            if(!template) template = options.index;
            readTemplate(template, function success(compiled) {
                var data;
                try {
                    data = compiled.render(params);
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
    };
};
