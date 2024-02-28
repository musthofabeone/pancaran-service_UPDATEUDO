const winston_ = require("winston");
const moment = require("moment");
const path = require("path");
const PROJECT_ROOT = path.join(__dirname, "..");
const { format, createLogger, transports } = require("winston");
const logLevel = 'debug';
const { combine, timestamp, label, printf } = format;
const CATEGORY = "Development Service Outgoing";
//Using the printf format.
const customFormat = printf(({ level, message, label, timestamp, ...rest }) => {
  let restString = JSON.stringify(rest, undefined, 4);
    restString = restString === '{}' ? '' : restString;
  return `${timestamp} [${label}] ${level}: ${message} ${restString}`;
});

var start = new Date();
var date = moment(start).format('YYYYMMDD')


require('winston-daily-rotate-file');

var transport = new winston_.transports.DailyRotateFile({
  filename: 'Log_Outgoing/application-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '14d'
});
require('winston-papertrail').Papertrail;

var winstonPapertrail = new winston_.transports.Papertrail({
  host: 'logs.papertrailapp.com',
  port: 12345
})

winstonPapertrail.on('error', function (err) {
  // Handle, report, or silently ignore connection errors and failures
});

var logger;

(function createLogger() {

  logger = new (winston_.createLogger)({
    format: format.combine(format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
      format.label({ label: path.basename(process.mainModule.filename) }),
      format.json(), format.splat()
    ),
    transports: [transport,
      new (winston_.transports.Console)({
        level: logLevel,
        colorize: true,
        json : true,
        timestamp: function () {
          return (new Date()).toLocaleTimeString();
        },
        prettyPrint: true,
        format: format.combine(
          winston_.format.colorize(), format.json(), format.splat(),
          label({ label: CATEGORY }), format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
          }), customFormat
        )
      })
    ]
  });

  winston_.addColors({
    error: 'red',
    warn: 'yellow',
    info: 'cyan',
    debug: 'blue',
    success: 'green'
  });
})();

if (process.env.NODE_ENV === "production") {
  logger.transports.console.level = "info";
}
if (process.env.NODE_ENV === "development") {
  logger.transports.console.level = "debug";
}

module.exports.info = function () {
  logger.info.apply(logger, formatLogArguments(arguments));
};
module.exports.log = function () {
  logger.log.apply(logger, formatLogArguments(arguments));
};
module.exports.warn = function () {
  logger.warn.apply(logger, formatLogArguments(arguments));
};
module.exports.debug = function () {
  logger.debug.apply(logger, formatLogArguments(arguments));
};
module.exports.verbose = function () {
  logger.verbose.apply(logger, formatLogArguments(arguments));
};

module.exports.error = function () {
  logger.error.apply(logger, formatLogArguments(arguments));
};

module.exports.success = function () {
  logger.success.apply(logger, formatLogArguments(arguments));
};

function formatLogArguments(args) {
  args = Array.prototype.slice.call(args);
  const stackInfo = getStackInfo(1);

  if (stackInfo) {
    const calleeStr = `(${stackInfo.relativePath}:${stackInfo.line})`;
    if (typeof args[0] === "string") {
      args[0] = args[0] + " " + calleeStr;
    } else {
      args.unshift(calleeStr);
    }
  }
  return args;
}

function getStackInfo(stackIndex) {
  const stacklist = new Error().stack.split("\n").slice(3);
  // http://code.google.com/p/v8/wiki/JavaScriptStackTraceApi
  // do not remove the regex expresses to outside of this method (due to a BUG in node.js)
  const stackReg = /at\s+(.*)\s+\((.*):(\d*):(\d*)\)/gi;
  const stackReg2 = /at\s+()(.*):(\d*):(\d*)/gi;

  const s = stacklist[stackIndex] || stacklist[0];
  const sp = stackReg.exec(s) || stackReg2.exec(s);

  if (sp && sp.length === 5) {
    return {
      method: sp[1],
      relativePath: path.relative(PROJECT_ROOT, sp[2]),
      line: sp[3],
      pos: sp[4],
      file: path.basename(sp[2]),
      stack: stacklist.join("\n")
    };
  }
}

logger.exitOnError = false;