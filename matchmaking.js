const rooms = require("./rooms");

let queue = {
ludo: [],
poker: [],
rummy: [],
carrom: []
};

function findMatch(socket, game){

queue[game].push(socket);

if(queue[game].length >= 2){

const player1 = queue[game].shift();
const player2 = queue[game].shift();

const roomId = "room_" + Date.now();

rooms.createRoom(roomId, game);

rooms.joinRoom(roomId, player1.id);
rooms.joinRoom(roomId, player2.id);

player1.join(roomId);
player2.join(roomId);

player1.emit("matchFound", {roomId});
player2.emit("matchFound", {roomId});

}
}

module.exports = {
findMatch
};
