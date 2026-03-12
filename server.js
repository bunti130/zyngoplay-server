const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const admin = require("firebase-admin");

/* FIREBASE ENV */

const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

/* EXPRESS */

const app = express();
app.use(cors());
app.use(express.json());

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

  socket.on("find_match",()=>{

    matchmakingQueue.push({
      socket:socket.id
    });

    if(matchmakingQueue.length >= 2){

      const player1 = matchmakingQueue.shift();
      const player2 = matchmakingQueue.shift();

      const roomId = "room_"+Date.now();

      io.to(player1.socket).emit("match_found",roomId);
      io.to(player2.socket).emit("match_found",roomId);

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

/* REGISTER SYSTEM */

app.post("/register",async(req,res)=>{

  try{

    const {userId,deviceId} = req.body;

    const deviceCheck = await db.collection("devices").doc(deviceId).get();

    if(deviceCheck.exists){
      return res.send({
        error:"Only one account allowed per device"
      });
    }

    await db.collection("devices").doc(deviceId).set({
      userId:userId
    });

    const walletRef = db.collection("wallets").doc(userId);

    const walletCheck = await walletRef.get();

    if(!walletCheck.exists){

      await walletRef.set({

        deposit:0,
        bonus:100,
        winning:0

      });

    }

    res.send({
      status:"account created",
      bonus:100
    });

  }catch(err){

    res.send({
      error:"register failed"
    });

  }

});

/* WALLET INFO */

app.get("/wallet/:userId",async(req,res)=>{

  try{

    const userId = req.params.userId;

    const wallet = await db.collection("wallets").doc(userId).get();

    if(!wallet.exists){

      return res.send({
        error:"wallet not found"
      });

    }

    res.send(wallet.data());

  }catch(err){

    res.send({
      error:"wallet error"
    });

  }

});

/* DEPOSIT API */

app.post("/deposit",async(req,res)=>{

  try{

    const {userId,amount} = req.body;

    const walletRef = db.collection("wallets").doc(userId);

    const wallet = await walletRef.get();

    if(!wallet.exists){

      return res.send({
        error:"wallet not found"
      });

    }

    const data = wallet.data();

    const newDeposit = data.deposit + amount;

    await walletRef.update({
      deposit:newDeposit
    });

    res.send({
      status:"deposit added",
      deposit:newDeposit
    });

  }catch(err){

    res.send({
      error:"deposit failed"
    });

  }

});

/* JOIN GAME (SMART DEDUCTION) */

app.post("/join-game",async(req,res)=>{

  try{

    const {userId,entryFee} = req.body;

    const walletRef = db.collection("wallets").doc(userId);

    const wallet = await walletRef.get();

    if(!wallet.exists){

      return res.send({
        error:"wallet not found"
      });

    }

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

    await walletRef.update({
      deposit,
      bonus,
      winning
    });

    res.send({
      status:"joined game",
      deposit,
      bonus,
      winning
    });

  }catch(err){

    res.send({
      error:"join game failed"
    });

  }

});

/* GAME WIN */

app.post("/game-win",async(req,res)=>{

  try{

    const {userId,prize} = req.body;

    const walletRef = db.collection("wallets").doc(userId);

    const wallet = await walletRef.get();

    if(!wallet.exists){

      return res.send({
        error:"wallet not found"
      });

    }

    const data = wallet.data();

    const newWinning = data.winning + prize;

    await walletRef.update({
      winning:newWinning
    });

    res.send({
      status:"prize added",
      winning:newWinning
    });

  }catch(err){

    res.send({
      error:"win update failed"
    });

  }

});

/* WITHDRAW */

app.post("/withdraw",async(req,res)=>{

  try{

    const {userId,amount} = req.body;

    const walletRef = db.collection("wallets").doc(userId);

    const wallet = await walletRef.get();

    if(!wallet.exists){

      return res.send({
        error:"wallet not found"
      });

    }

    const data = wallet.data();

    if(data.winning < amount){

      return res.send({
        error:"not enough winning balance"
      });

    }

    const newWinning = data.winning - amount;

    await walletRef.update({
      winning:newWinning
    });

    res.send({
      status:"withdraw request created",
      remainingWinning:newWinning
    });

  }catch(err){

    res.send({
      error:"withdraw failed"
    });

  }

});

/* SERVER START */

server.listen(process.env.PORT || 3000,()=>{

  console.log("ZyngoPlay server running");

});
