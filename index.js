var parseArgs = require('minimist'),
    fs = require('fs'),
    path = require("path"),
    cp = require("child_process"),
    async = require("async"),
    temp = require('temp'),
    execSync = require('exec-sync'),
    _ = require('lodash');

var args = parseArgs(process.argv.slice(2));
var crashLogs = args._;
var dsym = args.dsym || args.d;

console.log('crashLogs', crashLogs);
console.log('dsym', dsym);

// if (!_.endsWith(dsym, '.DSYM')) {
//     dsym += '.DSYM';
// }

var stats = fs.lstatSync(dsym);

if (!stats.isDirectory()) {
    throw new Error('DSYM is not a directory:' + dsym);
    // Yes it is
}
// Automatically track and cleanup files at exit
temp.track();

var extension = path.extname(dsym);
var appName = path.basename(dsym, extension);
console.log('appName', appName);
var uuidsString = execSync('dwarfdump --uuid "' + dsym + '"');
console.log('uuidsString', uuidsString);
var uuids = {};
var re = /UUID:\s(.*)\s\((.*)\)/g;
var match = re.exec(uuidsString),
    group;
while (match !== null) {
    uuids[match[2]] = match[1].toLowerCase().replace(/-/g, '');
    // matched text: match[0]
    // match start: match.index
    // capturing group n: match[n]
    match = re.exec(uuidsString);
}
console.log('uuids', uuids);

var dataLogs = [],
    resultLogs = [],
    data;
async.eachSeries(crashLogs, function(log, callback) {
    stats = fs.lstatSync(log);
    var cmd = path.join(__dirname, 'plcrashutil') + " convert --format=iphone \"" + log + "\"";
    console.log(cmd);
    cp.exec(cmd, function(err, stdout, stderr) {
        if (err) {
            console.log('stderr', stderr);
        } else {
            data = stdout;
            match = /0x.*?([a-zA-Z0-9]*)\s+<(.*)>.*Alpi\ Maps/.exec(stdout);
            if (match) {
                var uuid = uuids[match[1]];
                var toReplace = match[2];
                console.log('uuid', uuid);
                console.log('toReplace', toReplace);
                data = data.replace(new RegExp(toReplace, 'g'), uuid);
            }
            dataLogs.push(data);
        }
        callback();
    });
}, function(err) {
    // console.log(dataLogs);
    async.eachSeries(dataLogs, function(dataLog, callback) {
        temp.open('crash_log', function(err, info) {
            if (!err) {
                fs.write(info.fd, dataLog);
                fs.close(info.fd, function(err) {
                    var cmd = path.join(__dirname,
                        'symbolicatecrash') + ' "' + info.path + '" "' + dsym + '"';
                    console.log(cmd);
                    cp.exec(cmd, function(
                        err, stdout, stderr) {
                        if (err) {
                            console.log('stderr', stderr);
                        } else {
                            resultLogs.push(stdout);
                        }
                        callback();
                    });
                });
            }
        });

    }, function(err2) {
        _.each(resultLogs, function(log){
            console.log(log);
        });
    });
});