function rollDice(){
return Math.floor(Math.random()*6)+1;
}

function move(state, player, steps){

if(!state.positions) state.positions = {};

if(!state.positions[player]) state.positions[player] = 0;

state.positions[player] += steps;

if(state.positions[player] >= 52){
return {winner: player};
}

return state;
}

module.exports = {
rollDice,
move
};
