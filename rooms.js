const rooms = {};

function createRoom(roomId, game){
rooms[roomId] = {
game: game,
players: [],
state: {},
turn: 0
};
}

function joinRoom(roomId, player){
if(!rooms[roomId]) return null;
rooms[roomId].players.push(player);
return rooms[roomId];
}

function getRoom(roomId){
return rooms[roomId];
}

function removeRoom(roomId){
delete rooms[roomId];
}

module.exports = {
createRoom,
joinRoom,
getRoom,
removeRoom
};
