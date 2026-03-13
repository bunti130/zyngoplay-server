const express=require("express");
const http=require("http");
const {Server}=require("socket.io");
const cors=require("cors");
const admin=require("firebase-admin");

const ADMIN_TOKEN="zyngoplay_admin_secret";

const serviceAccount=JSON.parse(process.env.FIREBASE_KEY);

admin.initializeApp({
credential:admin.credential.cert(serviceAccount)
});

const db=admin.firestore();

const app=express();
app.use(cors());
app.use(express.json());

const server=http.createServer(app);

const io=new Server(server,{cors:{origin:"*"}});

/* ================= MEMORY ================= */

let rooms={}
let games={}
let matchmakingQueue={}
let transactions=[]
let tournaments=[]
let rateLimit={}
let reconnectMap={}

/* ================= RATE LIMIT ================= */

app.use((req,res,next)=>{

const ip=req.ip
const now=Date.now()

if(!rateLimit[ip]) rateLimit[ip]=[]

rateLimit[ip]=rateLimit[ip].filter(t=>now-t<60000)

rateLimit[ip].push(now)

if(rateLimit[ip].length>120){
return res.send({error:"too many requests"})
}

next()

})

/* ================= GAME ENGINES ================= */

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

this.turn=this.players[(this.players.indexOf(this.turn)+1)%this.players.length]

return{
positions:this.positions,
turn:this.turn
}

}

}

class CarromEngine{

constructor(players){
this.players=players
this.scores={}
players.forEach(p=>this.scores[p]=0)
}

pot(player){
this.scores[player]+=1
return{scores:this.scores}
}

}

/* ================= SOCKET ================= */

io.on("connection",(socket)=>{

socket.on("register_socket",(userId)=>{
reconnectMap[userId]=socket.id
})

socket.on("find_match",({userId,game,entryFee})=>{

if(!matchmakingQueue[game]){
matchmakingQueue[game]=[]
}

matchmakingQueue[game].push({
userId,
socket:socket.id,
entryFee
})

if(matchmakingQueue[game].length>=2){

const p1=matchmakingQueue[game].shift()
const p2=matchmakingQueue[game].shift()

const roomId="room_"+Date.now()

rooms[roomId]={
players:[p1.userId,p2.userId],
game,
entryFee:p1.entryFee,
state:"waiting",
createdAt:Date.now()
}

io.to(p1.socket).emit("match_found",roomId)
io.to(p2.socket).emit("match_found",roomId)

}

})

socket.on("join_room",({roomId,userId})=>{

socket.join(roomId)

if(!rooms[roomId]) return

io.to(roomId).emit("players",rooms[roomId].players)

})

socket.on("start_game",({roomId})=>{

const room=rooms[roomId]
if(!room) return

let engine

if(room.game==="ludo") engine=new LudoEngine(room.players)
if(room.game==="carrom") engine=new CarromEngine(room.players)

games[roomId]=engine
room.state="playing"

room.timer=setTimeout(()=>{
io.to(roomId).emit("game_timeout")
delete games[roomId]
},600000)

io.to(roomId).emit("game_started")

})

socket.on("ludo_move",({roomId,player,steps})=>{

const game=games[roomId]
if(!game) return

const result=game.move(player,steps)

io.to(roomId).emit("ludo_update",result)

})

socket.on("submit_result",async({roomId,winner})=>{

const room=rooms[roomId]

const prize=room.entryFee*2

const walletRef=db.collection("wallets").doc(winner)

const wallet=await walletRef.get()
const data=wallet.data()

await walletRef.update({
winning:data.winning+prize
})

transactions.push({
type:"win",
user:winner,
amount:prize,
roomId,
time:Date.now()
})

io.to(roomId).emit("game_finished",{winner,prize})

clearTimeout(room.timer)

delete games[roomId]

})

})

/* ================= REGISTER ================= */

app.post("/register",async(req,res)=>{

const {userId,deviceId}=req.body

const deviceCheck=await db.collection("devices").doc(deviceId).get()

if(deviceCheck.exists){
return res.send({error:"device already used"})
}

await db.collection("devices").doc(deviceId).set({userId})

await db.collection("wallets").doc(userId).set({
deposit:0,
bonus:100,
winning:0
})

res.send({status:"account created"})

})

/* ================= WALLET ================= */

app.get("/wallet/:userId",async(req,res)=>{

const wallet=await db.collection("wallets")
.doc(req.params.userId)
.get()

res.send(wallet.data())

})

/* ================= ENTRY FEE ================= */

app.post("/join_game",async(req,res)=>{

const {userId,entryFee}=req.body

const walletRef=db.collection("wallets").doc(userId)

const wallet=await walletRef.get()

const data=wallet.data()

let balance=data.deposit+data.bonus+data.winning

if(balance<entryFee){
return res.send({error:"not enough coins"})
}

await walletRef.update({
bonus:Math.max(0,data.bonus-entryFee)
})

transactions.push({
type:"entry",
user:userId,
amount:entryFee,
time:Date.now()
})

res.send({status:"joined game"})

})

/* ================= DEPOSIT ================= */

app.post("/deposit",async(req,res)=>{

const {userId,amount}=req.body

if(amount<10){
return res.send({error:"invalid amount"})
}

const walletRef=db.collection("wallets").doc(userId)

const wallet=await walletRef.get()

const data=wallet.data()

await walletRef.update({
deposit:data.deposit+amount
})

transactions.push({
type:"deposit",
user:userId,
amount,
time:Date.now()
})

res.send({status:"deposit success"})

})

/* ================= WITHDRAW ================= */

app.post("/withdraw",async(req,res)=>{

const {userId,amount,upi}=req.body

const walletRef=db.collection("wallets").doc(userId)

const wallet=await walletRef.get()

const data=wallet.data()

if(data.winning<amount){
return res.send({error:"not enough winning"})
}

await db.collection("withdraw_requests").add({
userId,
amount,
upi,
status:"pending",
time:Date.now()
})

res.send({status:"withdraw request created"})

})

/* ================= ADMIN ================= */

app.post("/admin/approve_withdraw",async(req,res)=>{

const {requestId,token}=req.body

if(token!==ADMIN_TOKEN){
return res.send({error:"unauthorized"})
}

const reqRef=db.collection("withdraw_requests").doc(requestId)

const reqData=(await reqRef.get()).data()

const walletRef=db.collection("wallets").doc(reqData.userId)

const wallet=(await walletRef.get()).data()

await walletRef.update({
winning:wallet.winning-reqData.amount
})

await reqRef.update({status:"approved"})

res.send({status:"withdraw approved"})

})

/* ================= LEADERBOARD ================= */

app.get("/leaderboard",async(req,res)=>{

const snap=await db.collection("wallets")
.orderBy("winning","desc")
.limit(10)
.get()

const list=[]

snap.forEach(doc=>{
list.push({
userId:doc.id,
...doc.data()
})
})

res.send(list)

})

/* ================= MATCH HISTORY ================= */

app.get("/match_history",(req,res)=>{
res.send(transactions)
})

/* ================= TOURNAMENT ================= */

app.post("/create_tournament",(req,res)=>{

const {name,entryFee}=req.body

const t={
id:"t_"+Date.now(),
name,
entryFee,
players:[],
created:Date.now()
}

tournaments.push(t)

res.send(t)

})

app.post("/join_tournament",(req,res)=>{

const {tournamentId,userId}=req.body

const t=tournaments.find(x=>x.id===tournamentId)

if(!t) return res.send({error:"not found"})

t.players.push(userId)

res.send({status:"joined tournament"})

})

/* ================= SERVER ================= */

server.listen(process.env.PORT||3000,()=>{
console.log("ZyngoPlay Server Running")
})
