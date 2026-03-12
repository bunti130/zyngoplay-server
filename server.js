const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const admin = require("firebase-admin");

const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

admin.initializeApp({
credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server,{
cors:{origin:"*"}
});

/* MEMORY */

let rooms = {};
let matchmakingQueue = {};
let games = {};

/* ============================= */
/* GAME ENGINES */
/* ============================= */

/* LUDO ENGINE */

class LudoEngine{

constructor(players){
this.players = players;
this.turn = players[0];
this.positions = {red:0,blue:0,green:0,yellow:0};
}

rollDice(){
return Math.floor(Math.random()*6)+1;
}

move(player,steps){

if(this.turn !== player){
return {error:"not your turn"};
}

this.positions[player] += steps;

this.nextTurn();

return{
positions:this.positions,
turn:this.turn
};

}

nextTurn(){

const index = this.players.indexOf(this.turn);

this.turn = this.players[(index+1)%this.players.length];

}

}

/* CHESS ENGINE */

const { Chess } = require("chess.js");

class ChessEngine{

constructor(){
this.game = new Chess();
}

move(from,to){

const move = this.game.move({
from,
to,
promotion:"q"
});

if(!move){
return {error:"invalid move"};
}

return{
fen:this.game.fen(),
turn:this.game.turn()
};

}

}

/* QUIZ ENGINE */

class QuizEngine{

constructor(players){

this.players = players;
this.scores = {};

players.forEach(p=>{
this.scores[p] = 0;
});

}

submitAnswer(player,correct){

if(correct){
this.scores[player] += 10;
}

return this.scores;

}

}

/* PUZZLE ENGINE */

class PuzzleEngine{

constructor(players){
this.players = players;
this.finished = {};
}

submitTime(player,time){
this.finished[player] = time;
}

winner(){

let best=null;

for(const p in this.finished){

if(!best || this.finished[p] < best.time){
best={player:p,time:this.finished[p]};
}

}

return best;

}

}

/* RUMMY ENGINE */

class RummyEngine{

constructor(players){

this.players = players;

this.deck=[];
this.hands={};

this.createDeck();
this.shuffle();
this.deal();

}

createDeck(){

const suits=["H","D","C","S"];

for(let s of suits){
for(let i=1;i<=13;i++){
this.deck.push(s+i);
}
}

}

shuffle(){
this.deck.sort(()=>Math.random()-0.5);
}

deal(){

this.players.forEach(p=>{
this.hands[p]=this.deck.splice(0,13);
});

}

}

/* ============================= */
/* SOCKET */
/* ============================= */

io.on("connection",(socket)=>{

console.log("User connected:",socket.id);

socket.on("find_match",(data)=>{

const {userId,game} = data;

if(!matchmakingQueue[game]){
matchmakingQueue[game]=[];
}

matchmakingQueue[game].push({
userId,
socket:socket.id
});

if(matchmakingQueue[game].length >=2){

const p1 = matchmakingQueue[game].shift();
const p2 = matchmakingQueue[game].shift();

const roomId="room_"+Date.now();

rooms[roomId]={
players:[p1.userId,p2.userId],
game
};

io.to(p1.socket).emit("match_found",roomId);
io.to(p2.socket).emit("match_found",roomId);

}

});

});

/* ============================= */
/* SERVER TEST */
/* ============================= */

app.get("/",(req,res)=>{
res.send("ZyngoPlay Server Running");
});

/* ============================= */
/* REGISTER */
/* ============================= */

app.post("/register",async(req,res)=>{

const {userId,deviceId} = req.body;

const deviceCheck = await db.collection("devices").doc(deviceId).get();

if(deviceCheck.exists){
return res.send({error:"device already used"});
}

await db.collection("devices").doc(deviceId).set({userId});

await db.collection("wallets").doc(userId).set({
deposit:0,
bonus:100,
winning:0
});

res.send({status:"account created"});

});

/* ============================= */
/* WALLET */
/* ============================= */

app.get("/wallet/:userId",async(req,res)=>{

const wallet = await db.collection("wallets")
.doc(req.params.userId)
.get();

res.send(wallet.data());

});

/* ============================= */
/* GAME CREATE */
/* ============================= */

app.post("/create-game",(req,res)=>{

const {game,players} = req.body;

let engine;

if(game==="ludo"){
engine = new LudoEngine(players);
}

if(game==="chess"){
engine = new ChessEngine();
}

if(game==="quiz"){
engine = new QuizEngine(players);
}

if(game==="puzzle"){
engine = new PuzzleEngine(players);
}

if(game==="rummy"){
engine = new RummyEngine(players);
}

const gameId="game_"+Date.now();

games[gameId]=engine;

res.send({gameId});

});

/* ============================= */
/* LEADERBOARD */
/* ============================= */

app.get("/leaderboard",async(req,res)=>{

const snap = await db.collection("wallets")
.orderBy("winning","desc")
.limit(10)
.get();

const list=[];

snap.forEach(doc=>{
list.push({
userId:doc.id,
...doc.data()
});
});

res.send(list);

});

/* ============================= */
/* SERVER START */
/* ============================= */

server.listen(process.env.PORT || 3000,()=>{
console.log("ZyngoPlay v3 server running");
});
