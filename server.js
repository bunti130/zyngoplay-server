const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const admin = require("firebase-admin");

/* FIREBASE KEY FROM ENV */

const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

/* EXPRESS APP */

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

/* SOCKET SERVER */

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

/* GAME MEMORY */

let rooms = {};
let matchmakingQueue = [];

/* SOCKET CONNECTION */

io.on("connection", (socket) => {

  console.log("User connected:", socket.id);

  /* JOIN ROOM */

  socket.on("join_room", (roomId) => {

    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = [];
    }

    rooms[roomId].push(socket.id);

    io.to(roomId).emit("players", rooms[roomId]);

  });

  /* MATCHMAKING */

  socket.on("find_match", () => {

    matchmakingQueue.push({
      socket: socket.id
    });

    if (matchmakingQueue.length >= 2) {

      const player1 = matchmakingQueue.shift();
      const player2 = matchmakingQueue.shift();

      const roomId = "room_" + Date.now();

      io.to(player1.socket).emit("match_found", roomId);
      io.to(player2.socket).emit("match_found", roomId);

    }

  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });

});

/* SERVER TEST */

app.get("/", (req, res) => {
  res.send("ZyngoPlay Server Running");
});

/* REGISTER SYSTEM */
/* 1 device = 1 account */

app.post("/register", async (req, res) => {

  try {

    const { userId, deviceId } = req.body;

    const deviceCheck = await db.collection("devices").doc(deviceId).get();

    if (deviceCheck.exists) {
      return res.send({
        error: "Only one account allowed per device"
      });
    }

    await db.collection("devices").doc(deviceId).set({
      userId: userId
    });

    const walletCheck = await db.collection("wallets").doc(userId).get();

    if (!walletCheck.exists) {

      await db.collection("wallets").doc(userId).set({
        coins: 100
      });

    }

    res.send({
      status: "account created",
      coins: 100
    });

  } catch (error) {

    res.send({
      error: "register failed"
    });

  }

});

/* WALLET BALANCE */

app.get("/wallet/:userId", async (req, res) => {

  try {

    const userId = req.params.userId;

    const wallet = await db.collection("wallets").doc(userId).get();

    if (!wallet.exists) {

      return res.send({
        error: "wallet not found"
      });

    }

    res.send(wallet.data());

  } catch (error) {

    res.send({
      error: "wallet error"
    });

  }

});

/* JOIN GAME */

app.post("/join-game", async (req, res) => {

  try {

    const { userId, entryFee } = req.body;

    const walletRef = db.collection("wallets").doc(userId);
    const wallet = await walletRef.get();

    if (!wallet.exists) {

      return res.send({
        error: "wallet not found"
      });

    }

    const data = wallet.data();

    if (data.coins < entryFee) {

      return res.send({
        error: "not enough coins"
      });

    }

    await walletRef.update({
      coins: data.coins - entryFee
    });

    res.send({
      status: "joined game",
      remainingCoins: data.coins - entryFee
    });

  } catch (error) {

    res.send({
      error: "join failed"
    });

  }

});

/* START SERVER */

server.listen(process.env.PORT || 3000, () => {

  console.log("ZyngoPlay server running");

});
