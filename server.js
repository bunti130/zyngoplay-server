const express=require("express")
const http=require("http")
const {Server}=require("socket.io")
const cors=require("cors")
const admin=require("firebase-admin")

const serviceAccount=JSON.parse(process.env.FIREBASE_KEY)

admin.initializeApp({
credential:admin.credential.cert(serviceAccount)
})

const db=admin.firestore()

const app=express()
app.use(cors())
app.use(express.json())

const server=http.createServer(app)

const io=new Server(server,{cors:{origin:"*"}})

/* MEMORY */

let rooms={}
let games={}
let matchmakingQueue={}

/* GAME ENGINES */

class LudoEngine{

constructor(players){
this.players=players
this.turn=players[0]
this.positions={}
players.forEach(p=>this.positions[p]=0)
}

move(player,steps){

if(this.turn!==player){
return{error:"not your turn"}
}

this.positions[player]+=steps

this.turn=this.players[
(this.players.indexOf(this.turn)+1)%this.players.length
]

return{
positions:this.positions,
turn:this.turn,
steps:steps
}

}

}

class PokerEngine{

constructor(players){

this.players=players
this.deck=[]
this.hands={}

this.createDeck()
this.shuffle()
this.deal()

}

createDeck(){

const suits=["H","D","C","S"]

for(let s of suits){
for(let i=1;i<=13;i++){
this.deck.push(s+i)
}
}

}

shuffle(){
this.deck.sort(()=>Math.random()-0.5)
}

deal(){

this.players.forEach(p=>{
this.hands[p]=this.deck.splice(0,2)
})

}

}

class RummyEngine{

constructor(players){

this.players=players
this.deck=[]
this.hands={}

this.createDeck()
this.shuffle()
this.deal()

}

createDeck(){

const suits=["H","D","C","S"]

for(let s of suits){
for(let i=1;i<=13;i++){
this.deck.push(s+i)
}
}

}

shuffle(){
this.deck.sort(()=>Math.random()-0.5)
}

deal(){

this.players.forEach(p=>{
this.hands[p]=this.deck.splice(0,13)
})

}

}

class CarromEngine{

constructor(players){

this.players=players
this.scores={}

players.forEach(p=>{
this.scores[p]=0
})

}

pot(player){

this.scores[player]+=1

return{
scores:this.scores
}

}

}

/* UNIVERSAL ENGINE LOADER */

function loadGameEngine(game,players){

if(game==="ludo"){
return new LudoEngine(players)
}

if(game==="poker"){
return new PokerEngine(players)
}

if(game==="rummy"){
return new RummyEngine(players)
}

if(game==="carrom"){
return new CarromEngine(players)
}

}

/* SOCKET */

io.on("connection",(socket)=>{

socket.on("find_match",({userId,game})=>{

if(!matchmakingQueue[game]){
matchmakingQueue[game]=[]
}

matchmakingQueue[game].push({
userId,
socket:socket.id
})

if(matchmakingQueue[game].length>=2){

const p1=matchmakingQueue[game].shift()
const p2=matchmakingQueue[game].shift()

const roomId="room_"+Date.now()

rooms[roomId]={
players:[p1.userId,p2.userId],
game
}

games[roomId]=loadGameEngine(game,rooms[roomId].players)

io.to(p1.socket).emit("match_found",roomId)
io.to(p2.socket).emit("match_found",roomId)

}

})

socket.on("join_room",({roomId,userId})=>{

socket.join(roomId)

if(!rooms[roomId]) return

io.to(roomId).emit("players",rooms[roomId].players)

})

socket.on("ludo_move",({roomId,player,steps})=>{

const game=games[roomId]

if(!game) return

const result=game.move(player,steps)

io.to(roomId).emit("ludo_update",result)

})

socket.on("carrom_pot",({roomId,player})=>{

const game=games[roomId]

if(!game) return

const result=game.pot(player)

io.to(roomId).emit("carrom_update",result)

})

})

/* SERVER */

server.listen(process.env.PORT||3000,()=>{
console.log("ZyngoPlay Server Running")
})
