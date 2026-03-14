const express = require("express")
const http = require("http")
const { Server } = require("socket.io")
const cors = require("cors")

const app = express()
app.use(cors())
app.use(express.json())

const server = http.createServer(app)

const io = new Server(server,{
  cors:{origin:"*"}
})

/* MEMORY */

let rooms = {}
let games = {}
let matchmakingQueue = {}
let turnTimers = {}

/* =========================
   GAME ENGINES
========================= */

class LudoEngine{

  constructor(players){
    this.players = players
    this.turn = players[0]
    this.positions = {}

    players.forEach(p=>{
      this.positions[p] = 0
    })
  }

  rollDice(){
    return Math.floor(Math.random()*6)+1
  }

  move(player,steps){

    if(player !== this.turn){
      return {error:"not your turn"}
    }

    this.positions[player] += steps

    const index = this.players.indexOf(player)
    this.turn = this.players[(index+1)%this.players.length]

    return{
      positions:this.positions,
      turn:this.turn
    }
  }
}

class PokerEngine{

  constructor(players){

    this.players = players
    this.deck = []
    this.hands = {}

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

  action(player,action){

    return{
      player,
      action,
      hands:this.hands
    }

  }

}

class RummyEngine{

  constructor(players){

    this.players = players
    this.deck = []
    this.hands = {}
    this.discard = []

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

  draw(player){

    const card = this.deck.pop()
    this.hands[player].push(card)

    return{
      player,
      card,
      hands:this.hands[player]
    }

  }

  discardCard(player,card){

    this.discard.push(card)

    this.hands[player]=this.hands[player].filter(c=>c!==card)

    return{
      player,
      discard:this.discard
    }

  }

}

class CarromEngine{

  constructor(players){

    this.players = players
    this.scores = {}

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

/* =========================
   ENGINE LOADER
========================= */

function loadGameEngine(game,players){

  if(game==="ludo") return new LudoEngine(players)

  if(game==="poker") return new PokerEngine(players)

  if(game==="rummy") return new RummyEngine(players)

  if(game==="carrom") return new CarromEngine(players)

}

/* =========================
   TURN TIMER
========================= */

function startTurnTimer(roomId){

  clearTimeout(turnTimers[roomId])

  turnTimers[roomId] = setTimeout(()=>{

    io.to(roomId).emit("turn_timeout")

  },10000)

}

/* =========================
   ROOM CLEANUP
========================= */

function cleanupRooms(){

  for(let roomId in rooms){

    if(!rooms[roomId] || rooms[roomId].players.length === 0){

      delete rooms[roomId]
      delete games[roomId]

    }

  }

}

setInterval(cleanupRooms,60000)

/* =========================
   SOCKET SERVER
========================= */

io.on("connection",(socket)=>{

  /* MATCHMAKING */

  socket.on("find_match",({userId,game})=>{

    if(!matchmakingQueue[game]){
      matchmakingQueue[game]=[]
    }

    matchmakingQueue[game].push({
      userId,
      socket:socket.id
    })

    if(matchmakingQueue[game].length>=2){

      const p1 = matchmakingQueue[game].shift()
      const p2 = matchmakingQueue[game].shift()

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

  /* JOIN ROOM */

  socket.on("join_room",({roomId,userId})=>{

    socket.join(roomId)

    if(!rooms[roomId]) return

    io.to(roomId).emit("players",rooms[roomId].players)

    startTurnTimer(roomId)

  })

  /* LUDO MOVE */

  socket.on("ludo_move",({roomId,player,steps})=>{

    const game = games[roomId]
    if(!game) return

    const result = game.move(player,steps)

    io.to(roomId).emit("ludo_update",result)

    startTurnTimer(roomId)

  })

  /* POKER ACTION */

  socket.on("poker_action",({roomId,player,action})=>{

    const game = games[roomId]
    if(!game) return

    const result = game.action(player,action)

    io.to(roomId).emit("poker_update",result)

  })

  /* RUMMY DRAW */

  socket.on("rummy_draw",({roomId,player})=>{

    const game = games[roomId]
    if(!game) return

    const result = game.draw(player)

    io.to(roomId).emit("rummy_update",result)

  })

  /* RUMMY DISCARD */

  socket.on("rummy_discard",({roomId,player,card})=>{

    const game = games[roomId]
    if(!game) return

    const result = game.discardCard(player,card)

    io.to(roomId).emit("rummy_update",result)

  })

  /* CARROM POT */

  socket.on("carrom_pot",({roomId,player})=>{

    const game = games[roomId]
    if(!game) return

    const result = game.pot(player)

    io.to(roomId).emit("carrom_update",result)

  })

  /* DISCONNECT */

  socket.on("disconnect",()=>{

    console.log("player disconnected")

  })

})

/* SERVER START */

server.listen(process.env.PORT || 3000,()=>{

  console.log("ZyngoPlay Multiplayer Server Running")

})
