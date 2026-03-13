const board = document.getElementById("board")

let positions = {}

function createBoard(){

for(let i=0;i<225;i++){

let cell=document.createElement("div")

cell.className="cell"

cell.id="cell"+i

board.appendChild(cell)

}

}

function rollDice(){

let dice=Math.floor(Math.random()*6)+1

document.getElementById("dice").innerText="Dice: "+dice

sendMove(dice)

}

function updateBoard(data){

positions=data.positions

Object.keys(positions).forEach(player=>{

let pos=positions[player]

let cell=document.getElementById("cell"+pos)

if(cell){

cell.innerHTML="🔴"

}

})

}

createBoard()
