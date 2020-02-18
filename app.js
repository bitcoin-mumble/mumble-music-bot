const EventEmitter = require('events');
const fs = require('fs');
const mumble = require('mumble');
const striptags = require('striptags');


// Config options
let initConfig;
try {
  initConfig = require('./config.js');
} catch (e) {
  console.log('[ERROR] Create file config.js with your settings based on config.js.example');
  console.error(e);
  process.exit(1);
}
const CONFIG = initConfig;

const {
  ADMINS, MAIN_NICK, MY_NICK, CHANN_NAME,
  MAX_VOL, MIN_VOL, DEFAULT_VOL, ACCESS_TOKENS,
} = CONFIG;

// State vars
var READY_TO_MSG = false;
var conn;
var chann = null;


// Process life handlers
function exitHandler(options, err) {
    if (chann) {
        chann.sendMessage('Core is DDoSing me! Papa Ver halp me!! Mah censorship!!!');
    }
    if (options.cleanup) console.log('clean');
    if (err) console.log(err.stack);
    if (options.exit) {
	console.log('[exitHandler] exiting in 100ms', options);
        setTimeout(function() {
            process.exit();
        }, 100);
    }
}
// catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, {exit:true}));

/// HELPERS
function secsToDuration(secs) {
  var secNum = parseInt(secs, 10);
  var hours   = Math.floor(secNum / 3600);
  var minutes = Math.floor((secNum - (hours * 3600)) / 60);
  var seconds = secNum - (hours * 3600) - (minutes * 60);

  if (minutes < 10) {minutes = '0'+minutes;}
  if (seconds < 10) {seconds = '0'+seconds;}
  return hours+':'+minutes+':'+seconds;
}

function hasAccess(user) {
  if (!user.isRegistered()) {
    user.sendMessage('- Sorry, only registered users can control the bot');
    return false;
  }
  return true;
}

function hasAdminAccess(user) {
  if (!user.isRegistered()) {
    // TODO: Fix auth bug
    user.sendMessage('- ERR: Oh hey, this is for admins only you cheeky bastard');
    return false;
  }
  return (ADMINS.indexOf(user.name) !== -1);
}


// Callback for every mumble incoming message
function onMsg(msg, user, scope){
  msg = striptags(msg).trim(); // Cleanup

  if (['channel', 'private'].indexOf(scope) === -1){
    return;
  }
  if (msg[0] === '!') {
    // Log commands
    //console.log('[MSGLOG] scope(' + scope + ') user(' + user.name + ') MSG:', msg);
    if (msg && msg.length < 5000) {
       console.log(new Date(), '[MSGLOG] scope(' + scope + ') user(' + user.name + ') MSG:', JSON.stringify(msg));
    } else {
       console.log(new Date(), '[MSGLOG] scope(' + scope + ') user(' + user.name + ') MSG:', (msg ? '~too lengthy' : '~empty'));
    }

  } else {
    // Accidental PM protection
    if (scope === 'private') {
      user.sendMessage("[I AM A BOT] Either you sent me an invalid command or you PMed me by mistake. Don't be a cuck (send me !help for help)");
    }
    if (msg && msg.length < 5000) {
       console.log(new Date(), '[MSGLOG-no!] scope(' + scope + ') user(' + user.name + ') MSG:', JSON.stringify(msg));
    } else {
       console.log('[MSGLOG-no!] scope(' + scope + ') user(' + user.name + ') MSG:', (msg ? '~too lengthy' : '~empty'));
    }
    return;
  }

  var isMaster = false;
  if (user.name === 'SirMeow') {
    isMaster = true;
  }

  // HOOK: Fake msg
  if (msg.indexOf('!say ') === 0) {
    chann.sendMessage(msg.split('!say ')[1]);
    return;
  }

  // HOOK: Restart
  if (msg === '!kill' || msg === '!restart' || msg === '!reboot') {
    if (hasAdminAccess(user)) {
      return process.exit(0);
    }
  }

  // HOOK: Add youtube to queue
  if (msg.indexOf('!add ') === 0 || msg.indexOf('!a ') === 0) {
    var yturl = msg.split(' ')[1];
    if (CONFIG.IS_TESTNET || (yturl.match(/https?:\/\/(www\.)?youtube\.com.+/) || yturl.match(/https?:\/\/(m\.)?youtube\.com.+/) || yturl.match(/https?:\/\/(www\.)?youtu\.be.+/))) {
      var song = new Song({
        url: yturl,
        owner: user.name,
      });
      var willPlayNow = queueYtSong(song);
      if (willPlayNow) {
        // chann.sendMessage('- Song starting...');
      } else {
        // TODO: depending on scope reply on private or channel
        if (scope === 'private') {
           user.sendMessage('- Song queued');
        } else {
           chann.sendMessage('- Song queued');
        }
      }
    } else {
      console.log('- WARN: Invalid yturl:', yturl);
    }
  // HOOK: whoami check
  } else if (msg === '!whoami') {
    if (hasAdminAccess(user)) {
      user.sendMessage('- You are a musicbot mod, but what am I?');
    } else {
      user.sendMessage("- You are a not a musicbot mod, you're probably a cuck (if not tell someone)");
    }
  // HOOK: bot status
  } else if (msg === '!status') {
    var helpMsg = [
      '<b>Status</b>:',
      'Volume: <b>' + djVolume + '</b>',
      'Currently playing: <b>' + (currentlyPlaying ? 'Yes' : 'No') + '</b>',
      'Queue: <b>' + (ytSongQueue.length) + '</b>',
      'Past Tracks: <b>' + (pastPlayedSongs.length) + '</b>',
      'Replay History: <b>' + (replayHistory ? 'Yes' : 'No') + '</b>'
    ];
    user.sendMessage(helpMsg.join('<br/>'));
  // HOOK: commands help
  } else if (msg === '!help' || msg === '!h') {
    var cmds = [
      '- <b>!vol {ratio}</b>      - Set volume '+MIN_VOL+' - ' + MAX_VOL,
      ' <u>Info</u>',
      '- <b>!status</b>           - Pretty useless playing status',
      '- <b>!current</b>          - Show the current track being played (alias: !c)',
      ' <u>Queue</u>',
      '- <b>!add {YoutubeURL}</b> - Add song (alias: !a)',
      '- <b>!skip</b>             - Skip current song (alias: !s)',
      //'- <b>!pause</b>            - Pause playing',
      //'- <b>!resume</b>           - Resume playing',
      '- <b>!remove {#indexNumber}</b>     - Remove a single track from the queue',
      '- <b>!list</b>             - List queue (alias: !l)',
      '- <b>!clear</b>            - Clear queue',
      ' <u>History</u>',
      '- <b>!history</b>          - List historical tracks',
      '- <b>!clearhistory</b>     - Clear historical tracks',
      '- <b>!removepast {#indexNumber}</b>     - Remove a single past played track from history',
      '- <b>!replaypast</b>       - If queue is empty, replay previous songs (currently: <b>' + (replayHistory ? 'ON' : 'OFF') + '</b>)',
      '- <b>!disablereplay</b>    - If queue is empty, replay previous songs',
      ' <u>Mods only</u>',
      '- <b>!whoami</b>           - Check if you are a mod',
      '- <b>!reboot</b>           - Reboots the bot, will lose queue & history',
      ' # <b>BU</b> <b>L</b>imit<b>l</b>ess Exclu<b>s</b>ive Opensource Propriatery Tec<b>h</b>nolog<b>i</b>es (<b>T</b>M):',
      '- <b>!play PepecashHymns</b>  - Embrace your inner pepe',
      '- <b>!play SupremeLeader</b>    - (alias: !play PapaVerLullaby)',
    ];
    var helpMsg = 'Available commands:<br/>' + cmds.join('<br/>');
    helpMsg += '<br/><i>(Powered by BitcoinUnlimited ASICBOOST code for maximum downtime)</i>';
    user.sendMessage(helpMsg);
  // HOOK: get volume level
  } else if (msg === '!vol') {
    user.sendMessage('Current volume: <b>' + djVolume + '</b> (Min: ' + MIN_VOL+' - Max: ' + MAX_VOL + ')');
  // HOOK: set volume
  } else if (msg.indexOf('!vol ') === 0 || msg.indexOf('!v ') === 0) {
    if (!hasAccess(user)) return;
    try {
      var vol = parseFloat(msg.split(' ')[1], 10);
      if (djVolume !== vol) {
        setVolume(vol, scope, user);
      }
    } catch (e){
      console.log('[ERR] Set vol to:', vol, ',ERR:', e);
    }
  // HOOK: clear playing history
  } else if (msg === '!clearhistory') {
    if (!hasAccess(user)) return;
    console.log('- HistoryTracks cleared');
    user.sendMessage('- History cleared');
    clearPlayedHistory();
  // HOOK: make the bot follow you to another channel
  } else if (msg === '!joinme' || msg === '!join') {
    if (!hasAccess(user)) return;
    console.log('- Request to joinchannel from:', user.name, 'isMaster:', isMaster);
    if (isMaster) {
      user.channel.join();
      chann = user.channel;
    }
  // HOOK: show the song queue
  } else if (msg === '!list' || msg === '!l') {
    if (ytSongQueue.length === 0) {
      return user.sendMessage('Queue: Empty');
    }
    var queueMsg = '- Current track: ' + getCurrenTrack();
    queueMsg += '<br/>- Current queue:<br/>'; // + ytSongQueue.join('<br/>');
    ytSongQueue.forEach(function(song, idx) {
      queueMsg += '#' + (idx+1) + '. ' + String(song) + '<br/>';
    });
    user.sendMessage(queueMsg);
  // HOOK: show past played tracks
  } else if (msg.indexOf('!history') === 0) {
    if (pastPlayedSongs.length === 0) {
      return user.sendMessage('- No tracks in history');
    }
    var page = 1;
    const pageSize = 5;
    var totalPages = Math.ceil(pastPlayedSongs.length / pageSize);

    // check page
    if (msg.indexOf('!history ') === 0) {
      var _p = msg.split(' ')[1].trim();
      if (!isNaN(_p) && parseInt(_p, 10) > 0) {
        page = parseInt(_p, 10);
      }
    }
    var pPage = page - 1;
    var respMsg = '- Past Played Songs '+ (totalPages > 1 ? '(' + totalPages + ' pages - use !history {pageNumber} to see the rest)' : '') +':<br/>'; // + ytSongQueue.join('<br/>');
    pastPlayedSongs.slice(pPage * pageSize, (pPage * pageSize) + pageSize).forEach(function(song, idx) {
      respMsg += '#' + (idx+1+(pPage * pageSize)) + '. ' + String(song) + '<br/>';
    });
    user.sendMessage(respMsg);
  // HOOK: remove song from history (you musical hitler)
  } else if (msg.indexOf('!removepasttrack ') === 0 || msg.indexOf('!removepastsong ') === 0 || msg.indexOf('!removepast ') === 0) {
    if (!hasAccess(user)) return;
    var core = msg.split(' ')[1];
    if (core[0] === '#') {
      core = core.slice(1);
    }
    core = parseInt(core, 10);
    if (!(core > 0 && core <= pastPlayedSongs.length)) {
      return user.sendMessage('- Error: could not find past song to remove');
    }
    var songRemoved = pastPlayedSongs.splice(core - 1, 1);
    user.sendMessage('- Removed past track: ' +  String(songRemoved));
  // HOOK: remove track for queue
  } else if (msg.indexOf('!remove ') === 0) {
    if (!hasAccess(user)) return;
    var core = msg.split(' ')[1];
    if (core[0] === '#') {
      core = core.slice(1);
    }
    core = parseInt(core, 10);
    if (!(core > 0 && core <= ytSongQueue.length)) {
      return user.sendMessage('- Error: could not find queued song to remove');
    }
    var songRemoved = ytSongQueue.splice(core - 1, 1);
    user.sendMessage('- Removed queued track: ' +  String(songRemoved));
  // HOOK: add/play bot's playlist
  } else if (msg.indexOf('!play ') === 0) {
    if (!hasAccess(user)) return;
    var request = msg.split('!play ')[1].toLowerCase();
    switch (request) {
      case 'pepecash':
      case 'bestofpepecash':
      case 'pepecashhymns':
      case 'pepehymns':
        var pepecashUrls = [
          'https://www.youtube.com/watch?v=6LKVWmsC2CQ',
          'https://www.youtube.com/watch?v=6GpkI0FtzhE',
          'https://www.youtube.com/watch?v=dfswfOe9Pro',
        ];
        pepecashUrls.forEach(function(yturl) {
          var song = new Song({
            url: yturl,
            owner: user.name
          });
          var willPlayNow = queueYtSong(song);
        });
        break;
      case 'supremeleader':
      case 'papaverlullaby':
        var urls = [
          'https://www.youtube.com/watch?v=UP1YsMlrfF0',
        ];
        urls.forEach(function(yturl) {
          var song = new Song({
            url: yturl,
            owner: user.name
          });
          var willPlayNow = queueYtSong(song);
        });
        break;
      default:
        console.log(' - [WARN] Requested to play:', request);
        return;
    }
  // HOOK: show current track
  } else if (msg === '!current' || msg === '!c') {
    user.sendMessage('- Current track: ' + getCurrenTrack());
  // HOOK: skip current playing track
  } else if (msg === '!skip' || msg === '!s') {
    if (!hasAccess(user)) return;
    skipCurrent();
  // HOOK: clear queue and stop playing
  } else if (msg === '!end' || msg === '!skipall' || msg === '!clear') {
    if (!hasAccess(user)) return;
    skipAll();
  // HOOK: replay past songs
  } else if (msg === '!replaypast') {
    if (!hasAccess(user)) return;
    if (!replayHistory) {
      replayHistory = true;
      chann.sendMessage('- <u>Config Change</u>: When queue is empty I will randomly replay previous songs');
      if (!currentlyPlaying) {
        checkQueuePlayNext();
      }
    }
  // HOOK: stop replaying past songs
  } else if (msg === '!disablereplay' || msg === '!disablereplaypast') {
    if (!hasAccess(user)) return;
    if (replayHistory) {
      replayHistory = false;
      chann.sendMessage('- <u>Config Change</u>: When queue is empty I will <b>NOT</b> replay previous songs');
    }
  } else {
    // Accidental PM protection
    if (scope === 'private') {
      user.sendMessage("[I AM A BOT] Either you sent me an invalid command or you PMed me by mistake. Don't be a cuck");
    }
  }
}

function onConnError(err) {
  console.error('[onConnError]', err);
  process.exit(1);
}

// Callback when connected to Mumble
function onMumbleConnected(error, connection) {
  if (error) { console.log('[CONNECT] ERR:', error); throw new Error(error); }

  console.log('(onConnect) Connected');
  conn = connection;
  connection.authenticate(MY_NICK, '', ACCESS_TOKENS);
  // Hooks
  connection.on('initialized', onAuthed);
  connection.on('message', onMsg);
  connection.on('error', onConnError);
}

// MUMBLE CONNECTION
var mumbleConnOpts = {};
if (!CONFIG.IS_TESTNET) {
  mumbleConnOpts = {
    key: fs.readFileSync(CONFIG.AUTH_KEY),
    cert: fs.readFileSync(CONFIG.AUTH_CERT),
  };
};

// Connect to mumble
console.log('Connecting to', CONFIG.MUMBLE_HOST);
mumble.connect('mumble://' + CONFIG.MUMBLE_HOST, mumbleConnOpts, onMumbleConnected);


// Callback after authentication
function onAuthed() {
  console.log( '(onAuthed) Connection initialized' );
  // Connection is authenticated and usable.
  chann = conn.channelByName(CHANN_NAME);
  chann.join();
  conn.user.setComment('A <b>B</b>adly<b>U</b>preared musicbot. Send !help for more');
  READY_TO_MSG = true;
};


// MUSIC stuff

//////// EVENTS
class MusicEmitter extends EventEmitter {}
const musicEmitter = new MusicEmitter();
musicEmitter.on('sendMsg', function(msg) {
  chann.sendMessage(msg);
});


////////////// VARS
var djVolume = DEFAULT_VOL; // DEFAULT
var currentlyPlaying = false;
var replayHistory = false;
var currentUrl = '';
var currentSong = null;
var lastMumbleInput;

////////// SONG
function Song(opts) {
  this.url = opts.url;
  this.owner = opts.owner;
  // TODO:
  // this.title = opts.title;
  this._allOpts = opts;
}
Song.prototype.toString = function() {
  return [
    '<a href="' + this.url + '">' + (this.title ? '"' + this.title + '"' : this.url) + '</a> ',
    (this.durationReadable ? '[' + this.durationReadable + '] ' : ''),
    '(added by ' + this.owner + ')'
  ].join('');
}
Song.prototype.setArtist = function(artist) {
  this.artist = artist;
}
Song.prototype.setTitle = function(title) {
  this.title = title;
}
Song.prototype.setDurationSeconds = function(secs) {
  this.durationSecs = secs;
  this.durationReadable = secsToDuration(secs);
}


///////// PLAYER HANDLING
function setVolume(newVol, shareAt, user) {
  if (newVol <= MAX_VOL && newVol >= MIN_VOL) {
    djVolume = newVol;
    conn.inputStream().setGain(djVolume);
    if (lastMumbleInput) {
      try {
        lastMumbleInput.setGain(djVolume);
      } catch (e) {
        console.log('[ERR] Setting volume:', e);
      }
    }

    if (shareAt === 'private') {
      if (user) {
        chann.sendMessage('- New volume: <b>' + newVol + '</b> set by ' + user.name);
      } else {
        console.log('[WARN!!!] Somehow setVolume in private but without user. Whats the cause? TODO');
        chann.sendMessage('- New volume: <b>' + newVol + '</b> .');
      }
    } else {
      user.sendMessage('- New volume: <b>' + newVol + '</b>');
    }
  }
}

function skipAll() {
  emptyQueue();
  skipCurrent();
}

var skipSignal = false;
var timeSkipAsked;
function skipCurrent() {
  if (!currentlyPlaying) {
    return console.log('[WARN] Cant skip if not playing.');
  }
  if (currentStream && typeof currentStream.end === 'function') {
    timeSkipAsked = Date.now();
    console.log('[--] Trying to skip');
    //conn.
    //lastMumbleInput.cork();
    skipSignal = true;
    currentStream._write = function (chunk, encoding, done) {
      done(); // Don't do anything with the data
    }
    currentStream.cork();
    currentStream.end();
    if (lastMumbleInput) {
      lastMumbleInput.end();
    }
    skipSignal = false;
    setTimeout(function() {
      if (timeSkipAsked) {
        console.log('-- TODO: If quite Should force currentlyPlayed=false');
        //currentlyPlaying = false;
      }
    }, 2000);
  } else {
    console.log('[ERR] Cant skip if stream not active');
  }
}

function getCurrenTrack() {
  if (currentSong && currentlyPlaying) {
    return String(currentSong);
  }
  return 'No track being played';
}


////////// PLAYING
const ffmpeg = require('fluent-ffmpeg');
const ytdl = require('ytdl-core');
const yasStream = require('youtube-audio-stream');
const youtubedl = require('ejoy-youtube-dl');

const corkPerSong = 0; //ms

const Decoder = require('lame').Decoder;
var currentStream;
function playSong(song, src) {
  // YouTubeDL for source
  // if (currentlyPlaying) {
  //     return console.log('[ERR] Tried to play url but was already playing.', String(song));
  // }
  // currentlyPlaying = true;
  //const url = 'http://youtube.com/watch?v=34aQNMvGEZQ'; // 'https://www.youtube.com/watch?v=sTInc59aq14'; //http://youtube.com/watch?v=34aQNMvGEZQ'

  var currentPlayStartedStreamingToMumble = false;
  try {
    var decoder = new Decoder();
    //var input = conn.inputStream();
    decoder.on('format', function(format) {
      console.log(' - playing');
      currentUrl = song.url;
      currentSong = song;

      musicEmitter.emit('sendMsg', '- '+ (src === 'HISTORY'?'(Shuffle History) ':'') +'Buffering ' + String(song) + '...');

      var mumbleInput = conn.inputStream({
        channels: format.channels,
        sampleRate: format.sampleRate,
        gain: djVolume
      });
      lastMumbleInput = mumbleInput;

      mumbleInput.cork();
      setTimeout(function() {
        console.log('- Uncorking...')
        conn.inputStream().uncork();
        if (currentlyPlaying) {
          process.nextTick(() => mumbleInput.uncork());
        }
      }, corkPerSong);

      mumbleInput
        .once('pipe', function() {
          console.log('- [MUMBINPUT] evt: PIPE');
          currentPlayStartedStreamingToMumble = true;
        });

      currentStream.pipe(mumbleInput)
        .on('finish', function() {
          console.log('YT[1] - finished','(Had currentPlayStartedStreamingToMumble:', currentPlayStartedStreamingToMumble?'YES':'NO',')'); // when finished playing track [2nd]
          if (!skipSignal) {
            addSuccessSong(song); // add to succes history for autoshuffling
          }
          afterPlayDone('finish');
        })
        .on('end', function() {
          console.log('YT[1] - ended'); // NOT VERIFIED
        })
        .on('error', function(err) {
          console.log('YT[1] - errored:', err);
          process.exit(1);
        });
    });

    function afterPlayDone(doneSrc) {
      if (timeSkipAsked) {
        var timeSkipTook = Date.now() - timeSkipAsked;
        console.log('-- [' + doneSrc + '] if it was skipped, it took:', timeSkipTook / 1000, 'seconds');
        timeSkipAsked = null;
      }
      currentlyPlaying = false;
      //mumbleInput.uncork(); // for when skipping happens
      //lastMumbleInput.uncork();
      //lastMumbleInput = undefined;
      //setVolume(djVolume);
      var willPlayNext = checkQueuePlayNext();
      if (!willPlayNext) {
        //musicEmitter.emit('sendMsg', '- Queue is empty... feed me! Use "!add {youtube url}"');
      } else {
        console.log('-- Will play something');
      }
    }

    if (1) {
      console.log('YT-STREAM');
      var ytdlOpts = { highWaterMark: 2 * 1024 * 1024 }; // bytes
      var throughOpts = { highWaterMark: 2 * 1024 * 1024 }; // bytes
      currentStream = yasStream(song.url, {}, ytdlOpts, throughOpts) // , {}, { highWaterMark: 512 * 1024 })
        .on('info', function(info) {
          song.setTitle(info.title);
          song.setArtist(info.author.name);
          if (info.length_seconds) {
              song.setDurationSeconds(info.length_seconds);
          } else {
              console.log('- [WARN] YT Didnt have length:', info);
          }
        })
        .pipe(decoder)
        .on('start', function() {
          console.log('YT[2] - starting...');
        })
        .on('finish', function() {
          console.log('YT[2] - finished', '(Had currentPlayStartedStreamingToMumble:', currentPlayStartedStreamingToMumble?'YES':'NO',')'); // early - when decoding ends
          if (!currentPlayStartedStreamingToMumble) {
            console.log('YT[2] - afterPlayDone - Probably skipped before it even started');
            afterPlayDone('BEFORESTART');
          }
        })
        .on('end', function() {
          console.log('YT[2] - ended'); // when finished playing track [1st]
          currentlyPlaying = false; // not sure
        })
        .on('error', function(err) {
          console.log('YT[2] - errored:', err);
        });
      currentStream.cork();
      setTimeout(() => { currentStream.uncork() }, corkPerSong);
    }

  } catch (e) {
      console.log('[ERR] Playing:', e);
      currentlyPlaying = false;
      checkQueuePlayNext();
  }
}


///////// QUEUE
var pastPlayedSongs = [];
var ytSongQueue = [];
function queueYtSong(song) {
  ytSongQueue.push(song);
  return checkQueuePlayNext();
}

function emptyQueue(){
  ytSongQueue = [];
}

function clearPlayedHistory() {
  pastPlayedSongs = [];
}

function checkQueuePlayNext(src) {
  if (currentlyPlaying) {
    if (src === 'FROM_')
    console.log('[WARN] Already plays');
    return false;
  }
  if (ytSongQueue.length === 0) {
    console.log('[WARN] Empty queue');
    if (replayHistory && pastPlayedSongs.length > 0) {
      process.nextTick(function() {
        setTimeout(function() {
          playSong(pastPlayedSongs[Math.floor(Math.random() * pastPlayedSongs.length)], 'HISTORY');
        }, 10);
      });
      currentlyPlaying = true;
      return true;
    }
    return false;
  }
  var nextSong = ytSongQueue.shift();
  console.log('- ToPlayNext:', String(nextSong));
  setTimeout(function(nextSong) {
    try {
      playSong(nextSong);
    } catch (e) {
      console.error('[ERR] Trying to playing the song. Error:', e);
      // TODO
      // Maybe trigger checkQueuePlayNext?
      chann.sendMessage('[Notice] North Corea is attacking my uber code, brb... #BUorDieTrying');
      process.exit(1);
    }
  }, 10, nextSong);
  currentlyPlaying = true;
  return true;
}

/////// HISTORY REPLAY
function addSuccessSong(song) {
    if (pastPlayedSongs.indexOf(song) === -1) {
        pastPlayedSongs.push(song);
    }
}
