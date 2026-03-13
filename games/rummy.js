function createDeck(){

let deck = [];

const suits = ["H","D","C","S"];
const values = [1,2,3,4,5,6,7,8,9,10,"J","Q","K"];

for(let s of suits){
for(let v of values){
deck.push(v+s);
}
}

return deck.sort(()=>Math.random()-0.5);
}

module.exports = {
createDeck
};
