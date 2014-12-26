var jws = require("jws"),
	config = require("../config.js"),
	fs = require("fs"),
	crypto = require('crypto'), core;

module.exports = function (c) {
	core = c;
	core.on("init", jwsHandler, "authentication");
};

function checkCurrentRooms(user, domain, callback) {
	core.emit("getRooms", {
		hasOcuppant: user,
		session: "internal-jws"
	}, function (err, rooms) {
		var shouldAllow = true,
			i, l, res;
		if (err) return callback(new Error("AUTH_FAIL_DATABASE/" + err.message));
		if (!rooms.results || !rooms.results.length) res = [];
		for (i = 0, l = res.length; i < l; i++) {
			if (res[i].guides && res[i].allowedDomains) {
				if (res[i].guides.allowedDomains.indexOf(domain) < 0) {
					shouldAllow = false;
					break;
				}
			} else {
				shouldAllow = false;
				break;
			}
		}
		return callback(null, shouldAllow);
	});
}

function jwsHandler(action, callback) {
	var domain, sigStream = fs.readFileSync("./keys").toString();
	if (!action.auth || !action.auth.jws) return callback();
	jws.createVerify({
		publicKey: config.publicKeys[action.origin.domain],
		signature: sigStream
	}).on('done', function(valid, data) {
		if(!valid) return callback(new Error("AUTH_FAIL: INVALID_TOKEN"));
		
		core.emit("getUsers", {
			identity: data.email,
			session: "internal"
		}, function (err, res) {
			var user;
			if (err) return callback(new Error("AUTH_FAIL_DATABASE/" + err.message));
			domain = action.origin.domain;
			user = (!res.results && res.results.length) ? res[0] : null;

			if (user) {
				if (/^guest-/.test(action.user.id)) {
					checkCurrentRooms(action.user.id, domain, function (err, shouldAllow) {
						if (err) return callback(err);
						if (!shouldAllow) {
							// this means that the user is online some other and his identity will change on other rooms. but he is an already existing user. so we should force the complete login.
							action.response = new Error("AUTH:Restricted");
							callback();
						} else {
							action.old = action.user;
							action.user = user;
							action.allowedDomains = [domain];
						}
					});
				} else {
					if (action.user.id == user.id) {
						if (action.user.allowedDomains) {
							action.user.allowedDomains.push(domain);
						} else {
							action.user.allowedDomains = [domain];
						}
					} else {
						//this state is when i am already logged in and a website gives me JSON signature and i cant do anything with it. so throwing error.
						callback(new Error("fail"));
					}
				}
			} else {
				//			signup?
				if (/^guest-/.test(action.user.id)) {
					checkCurrentRooms(action.user.id, domain, function (err, shouldAllow) {
						if (err) return callback(err);
						if (!shouldAllow) {

							action.response = new Error("AUTH:Restricted");
							callback();
						} else {
							action.old = action.user;
							action.user = {};
							action.user.identities = [action.auth.jws];
							action.user.picture = 'https://gravatar.com/avatar/' + crypto.createHash('md5').update(action.auth.jws).digest('hex') + '/?d=retro';
							action.response = new Error("AUTH:UNREGISTRED");
							return callback();
						}
					});
				} else {
					//				fail:
					callback(new Error("fail"));
				}
			}
		});	
	});
}
