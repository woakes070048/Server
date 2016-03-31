var express = require('express'),
	crash = require('express-crash'),
	bodyParser = require('body-parser'),
	cookieParser = require('cookie-parser'),
	session = require('express-session'),
	mongoose = require('mongoose'),
	nunjucks = require('nunjucks'),
	passport = require('passport'),
	flash = require('connect-flash'),
	secret = require('./config/secrets.js'),
	User = require('./config/models/user.js'),
	routes = require('./config/routes.js'),
	app = express(),
	http = require('http').Server(app),
	io = require('socket.io')(http);

// SETUP
nunjucks.configure(__dirname+'/views', {
	autoescape: true,
	express: app
});
app.use(session({
	secret: secret.session,
	saveUninitialized: true,
	resave: true
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
	extended: true
}));
app.use(cookieParser(secret.cookie));
app.use(flash());
app.use(passport.initialize());
app.use(passport.session());
app.use('/static', express.static(__dirname+'/static'));
routes(app);
mongoose.connect(secret.mongoSetup, {
	server:{socketOptions:{
		keepAlive:1, connectTimeoutMS:30000 }},
	replset:{socketOptions:{
		keepAlive:1, connectTimeoutMS:30000 }}
});


// Handle errors
var handle404 = function(req,res) {
	res.render('error.html', {code:404});
};
var handle500 = function(req,res) {
	res.render('error.html', {code:500});
};
if (secret.url.substring(0,16)!='http://localhost') {
	app.use(crash.handle404(handle404));
	app.use(crash.handle500(handle500));
	crash.trapRoute(app);
	crash.handle(app, handle404, handle500);
}

// Check for tracking users
function checkForUsers(room) {
	if (room) {
		io.to('app-'+room).emit('activate',
			(io.of("/").adapter.rooms[room])?'true':'false'
		);
	} else {
		User.find({}, function(err, users){
			if (err) { console.log(err); }
			users.forEach( function(user){
				checkForUsers(user.id);
			});
		});
	}
}

// Sockets
io.on('connection', function(socket) {
	
	socket.on('room', function(room) {
		socket.join(room);
		if (room.slice(0,4)!='app-'){
			User.findById({_id:room}, function(err, user) {
				if (err) { console.log(err); }
				if (user) {
					io.to('app-'+room).emit('activate','true'); }
			});
		} else {
			checkForUsers(room.slice(4));
		}
	});
	
	socket.on('app', function(loc){
		loc.time = Date.now();
		io.to(loc.usr).emit('trac', loc);
		User.findByIdAndUpdate(loc.usr, {last:{
			lat: parseFloat(loc.lat),
			lon: parseFloat(loc.lon),
			dir: parseFloat(loc.dir||0),
			spd: parseFloat(loc.spd||0),
			time: Date.now()
		}}, function(err, user) {
			if (err) { console.log(err); }
			if (!user) { console.log("No user found: "+loc.user); }
		});
	});

	socket.onclose = function(reason){
		var closedroom = Object.keys(
			socket.adapter.sids[socket.id]).slice(1)[0];
		setTimeout(function() {
			checkForUsers(closedroom);
		}, 3000);
		Object.getPrototypeOf(this).onclose.call(this,reason);
	}

});

// Serialize and deserialize users
passport.serializeUser(function(user, done) {
	done(null, user.id);
});
passport.deserializeUser(function(id, done) {
	User.findById(id, function(err, user) {
		if(!err) done(null, user);
		else done(err, null);
	});
});

// SERVE
http.listen(secret.port, function(){
	console.log('Listening for http on port '+secret.port);
	checkForUsers();
});

module.exports = app;
