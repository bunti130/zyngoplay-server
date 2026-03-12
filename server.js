const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const admin = require("firebase-admin");

const serviceAccount = require("./firebase-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

let rooms = {};
let matchmakingQueue = [];

io.on("connection", (socket) => {

  console.log("User connected:", socket.id);

  socket.on("join_room", (roomId) => {

    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = [];
    }

    rooms[roomId].push(socket.id);

    io.to(roomId).emit("players", rooms[roomId]);

  });

  socket.on("find_match", (player) => {

    matchmakingQueue.push(player);

    if (matchmakingQueue.length >= 2) {

      const player1 = matchmakingQueue.shift();
      const player2 = matchmakingQueue.shift();

      const roomId = "room_" + Date.now();

      io.to(player1.socket).emit("match_found", roomId);
      io.to(player2.socket).emit("match_found", roomId);

    }

  });

  socket.on("disconnect", () => {
    console.log("User disconnected");
  });

});

app.get("/", (req, res) => {
  res.send("ZyngoPlay Server Running");
});


/* REGISTER SYSTEM
1 phone = 1 account
100 coin signup reward
*/

app.post("/register", async (req, res) => {

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

  await db.collection("wallets").doc(userId).set({
    coins: 100
  });

  res.send({
    status: "account created",
    coins: 100
  });

});


/* WALLET BALANCE */

app.get("/wallet/:userId", async (req, res) => {

  const userId = req.params.userId;

  const wallet = await db.collection("wallets").doc(userId).get();

  if (!wallet.exists) {
    return res.send({
      error: "wallet not found"
    });
  }

  res.send(wallet.data());

});


server.listen(3000, () => {
  console.log("Server running on port 3000");
});
