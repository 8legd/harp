var path    = require("path")
var fs      = require("fs")
var jade    = require("jade")
var helpers = require("./helpers")
var mime    = require("mime")
var polymer = require('polymer')
var pkg     = require('../package.json')

var send = require('../node_modules/connect/node_modules/send')
  , utils = require('../node_modules/connect/lib/utils')
  , parse = utils.parseUrl
  , url = require('url')

exports.notMultihostURL = function(req, rsp, next){
  var host      = req.headers.host
  var hostname  = host.split(':')[0]
  var arr       = hostname.split(".")
  var port      = host.split(':')[1] ? ':' + host.split(':')[1] : ''

  if(hostname == "127.0.0.1" || hostname == "localhost"){
    rsp.statusCode = 307
    rsp.setHeader('Location', 'http://harp.nu' + port)
    rsp.end("redirecting you to http://harp.nu" + port)
  }else if(arr.length == 4){
    arr.pop()
    arr.push('io')
    var link = 'http://' + arr.join('.') + port
    var body = "Local server does not support history. Perhaps you are looking for <href='" + link + "'>" + link + "</a>."
    rsp.statusCode = 307
    rsp.end(body)
  }else if(arr.length > 4){
    arr.shift()
    var link = 'http://' + arr.join('.') + port
    rsp.statusCode = 307
    rsp.setHeader('Location', link)
    rsp.end("redirecting you to " + link)
  }else{
    next()
  }
}

exports.index = function(dirPath){
  return function(req, rsp, next){
    var host      = req.headers.host
    var hostname  = host.split(':')[0]
    var arr       = hostname.split(".")
    var port      = host.split(':')[1] ? ':' + host.split(':')[1] : ''

    if(arr.length == 2){
      fs.readdir(dirPath, function(err, files){
        var projects = []

        files.forEach(function(file){
          if(file.split(".").length == 3){

            var portal = file.split('.')
            portal.shift()

            var local = file.split('.')
            local.pop()
            local.pop()
            local.push(host)

            projects.push({
              "name"      : file,
              "localUrl"  : 'http://' + local.join('.'),
              "remoteUrl" : 'http://' + file,
              "portalUrl" : 'http://' + portal.join('.') + '/apps/' + file,
              "localPath" : path.resolve(dirPath, file)
            })
          }
        })

        var poly = polymer.root(__dirname + "/templates")
        poly.render("index.jade", { pkg: pkg, projects: projects, layout: "layout.jade" }, function(error, body){
          rsp.end(body)
        })

      })
    }else{
      next()
    }

  }
}

exports.hostProjectFinder = function(dirPath){
  return function(req, rsp, next){
    var host        = req.headers.host
    var hostname    = host.split(':')[0]
    var matches     = []

    fs.readdir(dirPath, function(err, files){

      [".io", ".me"].forEach(function(ext){
        var val = hostname.replace(/\.\w+$/, ext)
        if(files.indexOf(val) !== -1){
          matches.push(val)
        }
      })

      if(matches.length > 0){
        req.projectPath = path.resolve(dirPath, matches[0])
        next()
      }else{
        rsp.end("Cannot find project")
      }

    })

  }
}

exports.regProjectFinder = function(projectPath){
  return function(req, rsp, next){
    req.projectPath = projectPath
    next()
  }
}

exports.static = function(req, res, next) {
  var options  = {}
  var redirect = true

  if ('GET' != req.method && 'HEAD' != req.method) return next();
  var pathn = parse(req).pathname;
  var pause = utils.pause(req);

  function resume() {
    next();
    pause.resume();
  }

  function directory() {
    if (!redirect) return resume();
    var pathname = url.parse(req.originalUrl).pathname;
    res.statusCode = 301;
    res.setHeader('Location', pathname + '/');
    res.end('Redirecting to ' + utils.escape(pathname) + '/');
  }

  function error(err) {
    if (404 == err.status) return resume();
    next(err);
  }

  send(req, pathn)
    .maxage(options.maxAge || 0)
    .root(path.resolve(req.projectPath, "public"))
    .hidden(options.hidden)
    .on('error', error)
    .on('directory', directory)
    .pipe(res)
}

/**
 * Opens the (optional) harp.json file and sets the config settings.
 */

exports.parseHarpConfig = function(req, rsp, next){

  try{
    req.config = helpers.config(req.projectPath)
  }catch(error){
    error.project = req.headers.host
    return polymer.root(__dirname + "/templates").render("error.jade", error, function(err, body){
      rsp.statusCode = 500
      rsp.end(body)
    })
  }

  next()
}


/**
 * Sets up the poly object
 */

exports.poly = function(req, rsp, next){
  req.poly = polymer.root(path.join(req.projectPath, 'public'), req.config.globals)
  next()
}


/**
 * Asset Pipeline
 */

exports.process = function(req, rsp, next){
  var normalizedPath  = helpers.normalizeUrl(req.url)
  var priorityList    = polymer.helpers.buildPriorityList(normalizedPath)
  var sourceFile      = polymer.helpers.findFirstFile(path.join(req.projectPath, "public"), priorityList)

  /**
   * We GTFO if we don't have a source file.
   */

  if(!sourceFile) return next()


  /**
   * Now we let Polymer handle the asset pipeline.
   */

  req.poly.render(sourceFile, function(error, body){
    if(error){
      var locals = {
        project: req.headers.host,
        name: error.name,
        message: error.message,
        filename: sourceFile,
        stack: error.stack
      }
      if(polymer.helpers.outputType(sourceFile) == 'css'){
        rsp.status = 500
        rsp.end(helpers.cssError(locals))
      }else{
        polymer.root(__dirname + "/templates").render("error.jade", locals, function(err, body){
          rsp.status = 500
          rsp.end(body)
        })
      }
    }else{
      if(!body) return next() // 404

      var outputType = polymer.helpers.outputType(sourceFile)
      var mimeType   = helpers.mimeType(outputType)
      var charset    = mime.charsets.lookup(outputType)
      rsp.statusCode = 200
      rsp.setHeader('Content-Type', mimeType + (charset ? '; charset=' + charset : ''))
      rsp.setHeader('Content-Length', body.length)
      rsp.end(body)
    }
  })

}

exports.customNotFound = function(req, rsp, next){
  var publicPath = path.join(req.projectPath, "public")
  var list       = ['404.html', '404.jade', '404.html.jade']
  var sourceFile = polymer.helpers.findFirstFile(publicPath, list)

  if(!sourceFile) return next()

  req.poly.render(sourceFile, function(error, body){
    if(error){
      // TODO: make this better
      rsp.statusCode = 404;
      rsp.end("There is an error in your " + sourceFile + " file")
    }else{
      if(!body) return next()
      var type    = helpers.mimeType("html")
      var charset = mime.charsets.lookup(type)
      rsp.setHeader('Content-Type', type + (charset ? '; charset=' + charset : ''));
      rsp.setHeader('Content-Length', body.length);
      rsp.statusCode = 404;
      rsp.end(body)
    }
  })
}

exports.devFallbackNotFound = function(req, rsp){
  var locals = {
    project: req.headers.host,
    name: "Page Not Found",
    layout: "layout.jade"
  }
  polymer.root(__dirname + "/templates").render("404.jade", locals, function(err, body){
    rsp.status = 500
    rsp.end(body)
  })
}
