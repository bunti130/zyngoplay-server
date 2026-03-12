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
  cors:{ origin:"*" }
});

/* RATE LIMITER */

const rateLimit = require("express-rate-limit");

const limiter = rateLimit({
  windowMs: 10 * 1000,
  max: 30
});

app.use(limiter);

/* MEMORY */

let rooms = {};
let matchmakingQueue = {};
let gameStates = {};

/* SOCKET */

io.on("connection",(socket)=>{

  console.log("User connected:",socket.id);

  socket.on("find_match",(data)=>{

    const {userId,game} = data;

    if(!matchmakingQueue[game]){
      matchmakingQueue[game] = [];
    }

    matchmakingQueue[game].push({
      userId,
      socket:socket.id
    });

    if(matchmakingQueue[game].length >= 2){

      const p1 = matchmakingQueue[game].shift();
      const p2 = matchmakingQueue[game].shift();

      const roomId = "room_"+Date.now();

      rooms[roomId] = {
        players:[p1.userId,p2.userId],
        game,
        state:{}
      };

      gameStates[roomId] = {
        turn:p1.userId,
        moves:[]
      };

      io.to(p1.socket).emit("match_found",roomId);
      io.to(p2.socket).emit("match_found",roomId);

    }

  });

  socket.on("disconnect",()=>{
    console.log("disconnect",socket.id);
  });

});

/* SERVER TEST */

app.get("/",(req,res)=>{
  res.send("ZyngoPlay Server Running");
});

/* REGISTER */

app.post("/register",async(req,res)=>{

  const {userId,deviceId} = req.body;

  const deviceCheck = await db.collection("devices").doc(deviceId).get();

  if(deviceCheck.exists){
    return res.send({error:"device already used"});
  }

  await db.collection("devices").doc(deviceId).set({
    userId
  });

  await db.collection("wallets").doc(userId).set({
    deposit:0,
    bonus:100,
    winning:0
  });

  res.send({
    status:"account created"
  });

});

/* WALLET */

app.get("/wallet/:userId",async(req,res)=>{

  const wallet = await db.collection("wallets")
  .doc(req.params.userId)
  .get();

  res.send(wallet.data());

});

/* DEPOSIT */

app.post("/deposit",async(req,res)=>{

  const {userId,amount} = req.body;

  const ref = db.collection("wallets").doc(userId);

  const wallet = await ref.get();

  const data = wallet.data();

  await ref.update({
    deposit:data.deposit + amount
  });

  res.send({status:"deposit added"});

});

/* JOIN GAME */

app.post("/join-game",async(req,res)=>{

  const {userId,entryFee} = req.body;

  const ref = db.collection("wallets").doc(userId);
  const wallet = await ref.get();

  let {deposit,bonus,winning} = wallet.data();

  let fee = entryFee;

  if(bonus >= fee){
    bonus -= fee;
    fee = 0;
  }else{
    fee -= bonus;
    bonus = 0;
  }

  if(fee > 0){

    if(deposit >= fee){
      deposit -= fee;
      fee = 0;
    }else{
      fee -= deposit;
      deposit = 0;
    }

  }

  if(fee > 0){

    if(winning >= fee){
      winning -= fee;
      fee = 0;
    }else{
      return res.send({
        error:"not enough balance"
      });
    }

  }

  await ref.update({
    deposit,
    bonus,
    winning
  });

  res.send({
    status:"game joined"
  });

});

/* GAME RESULT ENGINE */

app.post("/submit-result",async(req,res)=>{

  const {roomId,winner,prize} = req.body;

  if(!rooms[roomId]){
    return res.send({error:"room not found"});
  }

  const walletRef = db.collection("wallets").doc(winner);
  const wallet = await walletRef.get();

  const data = wallet.data();

  await walletRef.update({
    winning:data.winning + prize
  });

  delete rooms[roomId];

  res.send({
    status:"result accepted"
  });

});

/* WITHDRAW REQUEST */

app.post("/withdraw-request",async(req,res)=>{

  const {userId,amount} = req.body;

  const wallet = await db.collection("wallets")
  .doc(userId)
  .get();

  const data = wallet.data();

  if(data.winning < amount){
    return res.send({
      error:"not enough winning"
    });
  }

  const id = "wd_"+Date.now();

  await db.collection("withdraw_requests")
  .doc(id)
  .set({
    userId,
    amount,
    status:"pending",
    createdAt:Date.now()
  });

  res.send({
    status:"withdraw request submitted"
  });

});

/* TEST WITHDRAW */

app.get("/test-withdraw",async(req,res)=>{

  const id = "wd_"+Date.now();

  await db.collection("withdraw_requests")
  .doc(id)
  .set({
    userId:"testuser",
    amount:50,
    status:"pending",
    createdAt:Date.now()
  });

  res.send("Test withdraw created");

});

/* ADMIN VIEW */

app.get("/admin/withdraw-requests",async(req,res)=>{

  const snap = await db.collection("withdraw_requests")
  .where("status","==","pending")
  .get();

  const list = [];

  snap.forEach(doc=>{
    list.push({
      id:doc.id,
      ...doc.data()
    });
  });

  res.send(list);

});

/* ADMIN APPROVE */

app.post("/admin/approve-withdraw",async(req,res)=>{

  const {requestId} = req.body;

  const ref = db.collection("withdraw_requests").doc(requestId);

  const reqDoc = await ref.get();

  const data = reqDoc.data();

  const walletRef = db.collection("wallets").doc(data.userId);

  const wallet = await walletRef.get();

  const w = wallet.data();

  await walletRef.update({
    winning:w.winning - data.amount
  });

  await ref.update({
    status:"approved"
  });

  res.send({
    status:"withdraw approved"
  });

});

/* LEADERBOARD */

app.get("/leaderboard",async(req,res)=>{

  const snap = await db.collection("wallets")
  .orderBy("winning","desc")
  .limit(10)
  .get();

  const list = [];

  snap.forEach(doc=>{
    list.push({
      userId:doc.id,
      ...doc.data()
    });
  });

  res.send(list);

});

/* TOURNAMENT CREATE */

app.post("/create-tournament",async(req,res)=>{

  const {name,entryFee,prize} = req.body;

  const id = "tour_"+Date.now();

  await db.collection("tournaments")
  .doc(id)
  .set({
    name,
    entryFee,
    prize,
    players:[],
    status:"open"
  });

  res.send({
    status:"tournament created"
  });

});

/* JOIN TOURNAMENT */

app.post("/join-tournament",async(req,res)=>{

  const {userId,tournamentId} = req.body;

  const ref = db.collection("tournaments").doc(tournamentId);

  const doc = await ref.get();

  const data = doc.data();

  data.players.push(userId);

  await ref.update({
    players:data.players
  });

  res.send({
    status:"joined tournament"
  });

});

/* SERVER START */

server.listen(process.env.PORT || 3000,()=>{
  console.log("ZyngoPlay v2 server running");
});
