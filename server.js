const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const admin = require("firebase-admin");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");

/* FIREBASE */

const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

/* EXPRESS */

const app = express();
app.use(cors());
app.use(express.json());
app.use(helmet());

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100
});

app.use(limiter);

const server = http.createServer(app);

/* SOCKET */

const io = new Server(server,{
  cors:{ origin:"*" }
});

/* MEMORY */

let rooms = {};
let matchmakingQueue = [];

/* SOCKET CONNECTION */

io.on("connection",(socket)=>{

  console.log("User connected:",socket.id);

  socket.on("join_room",(roomId)=>{

    socket.join(roomId);

    if(!rooms[roomId]){
      rooms[roomId] = [];
    }

    rooms[roomId].push(socket.id);

    io.to(roomId).emit("players",rooms[roomId]);

  });

  socket.on("find_match",(data)=>{

    matchmakingQueue.push({
      socket:socket.id,
      userId:data.userId
    });

    if(matchmakingQueue.length >= 2){

      const p1 = matchmakingQueue.shift();
      const p2 = matchmakingQueue.shift();

      const roomId = "room_"+Date.now();

      io.to(p1.socket).emit("match_found",roomId);
      io.to(p2.socket).emit("match_found",roomId);

    }

  });

  socket.on("disconnect",()=>{
    console.log("User disconnected:",socket.id);
  });

});

/* SERVER TEST */

app.get("/",(req,res)=>{
  res.send("ZyngoPlay Server Running");
});

/* REGISTER */

app.post("/register",async(req,res)=>{

  try{

    const {userId,deviceId} = req.body;

    const deviceCheck = await db.collection("devices").doc(deviceId).get();

    if(deviceCheck.exists){
      return res.send({error:"Only one account allowed"});
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
      status:"account created",
      bonus:100
    });

  }catch(e){

    res.send({error:"register failed"});

  }

});

/* WALLET INFO */

app.get("/wallet/:userId",async(req,res)=>{

  const wallet = await db.collection("wallets")
    .doc(req.params.userId)
    .get();

  if(!wallet.exists){
    return res.send({error:"wallet not found"});
  }

  res.send(wallet.data());

});

/* JOIN GAME */

app.post("/join-game",async(req,res)=>{

  const {userId,entryFee} = req.body;

  const walletRef = db.collection("wallets").doc(userId);
  const wallet = await walletRef.get();

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
      return res.send({error:"not enough balance"});
    }

  }

  await walletRef.update({
    deposit,
    bonus,
    winning
  });

  res.send({
    status:"joined game"
  });

});

/* GAME RESULT ENGINE */

app.post("/submit-result",async(req,res)=>{

  try{

    const {roomId,winnerId,loserId,prize} = req.body;

    if(!roomId || !winnerId){
      return res.send({error:"invalid result"});
    }

    /* save match history */

    const matchId = "match_"+Date.now();

    await db.collection("matches")
      .doc(matchId)
      .set({
        roomId,
        winnerId,
        loserId,
        prize,
        createdAt:Date.now()
      });

    /* update winner wallet */

    const walletRef = db.collection("wallets").doc(winnerId);
    const wallet = await walletRef.get();

    const data = wallet.data();

    await walletRef.update({
      winning:data.winning + prize
    });

    /* update leaderboard */

    const boardRef = db.collection("leaderboard").doc(winnerId);
    const board = await boardRef.get();

    if(board.exists){

      const stats = board.data();

      await boardRef.update({
        wins:stats.wins + 1,
        totalPrize:stats.totalPrize + prize
      });

    }else{

      await boardRef.set({
        wins:1,
        totalPrize:prize
      });

    }

    res.send({
      status:"result recorded"
    });

  }catch(err){

    res.send({
      error:"result engine failed"
    });

  }

});

/* MATCH HISTORY */

app.get("/match-history/:userId",async(req,res)=>{

  const snapshot = await db.collection("matches")
    .where("winnerId","==",req.params.userId)
    .get();

  const matches = [];

  snapshot.forEach(doc=>{
    matches.push(doc.data());
  });

  res.send(matches);

});

/* LEADERBOARD */

app.get("/leaderboard",async(req,res)=>{

  const snapshot = await db.collection("leaderboard")
    .orderBy("wins","desc")
    .limit(20)
    .get();

  const list = [];

  snapshot.forEach(doc=>{
    list.push({
      userId:doc.id,
      ...doc.data()
    });
  });

  res.send(list);

});

/* WITHDRAW REQUEST */

app.post("/withdraw-request",async(req,res)=>{

  const {userId,amount} = req.body;

  const wallet = await db.collection("wallets").doc(userId).get();
  const data = wallet.data();

  if(data.winning < amount){
    return res.send({
      error:"not enough winning balance"
    });
  }

  const requestId = "wd_"+Date.now();

  await db.collection("withdraw_requests")
    .doc(requestId)
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

/* ADMIN VIEW */

app.get("/admin/withdraw-requests",async(req,res)=>{

  const snapshot = await db.collection("withdraw_requests")
    .where("status","==","pending")
    .get();

  const list = [];

  snapshot.forEach(doc=>{
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

  const requestRef = db.collection("withdraw_requests").doc(requestId);
  const request = await requestRef.get();

  const data = request.data();

  const walletRef = db.collection("wallets").doc(data.userId);
  const wallet = await walletRef.get();

  const walletData = wallet.data();

  await walletRef.update({
    winning:walletData.winning - data.amount
  });

  await requestRef.update({
    status:"approved"
  });

  res.send({
    status:"withdraw approved"
  });

});

/* ADMIN REJECT */

app.post("/admin/reject-withdraw",async(req,res)=>{

  const {requestId} = req.body;

  await db.collection("withdraw_requests")
    .doc(requestId)
    .update({
      status:"rejected"
    });

  res.send({
    status:"withdraw rejected"
  });

});

/* SERVER START */

server.listen(process.env.PORT || 3000,()=>{

  console.log("ZyngoPlay server running");

});
