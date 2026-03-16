async function askAI(question){

question = question.replace(/[ァ-ン]/g, s =>
String.fromCharCode(s.charCodeAt(0) - 0x60)
)

const res = await fetch("/search/search-index.json")
const data = await res.json()

let context = ""

data.forEach(item=>{

const text = (item.title + item.text).toLowerCase()

if(text.includes(question.toLowerCase())){
context += item.title + "\n"
context += item.text + "\n\n"
}

})

if(context === ""){
document.getElementById("ai-result").innerHTML =
"該当する資料が見つかりませんでした。"
return
}

const response = await fetch("/functions/ai",{
method:"POST",
headers:{
"Content-Type":"application/json"
},
body:JSON.stringify({
question:question,
context:context
})
})

const result = await response.json()

document.getElementById("ai-result").innerHTML =
result.answer

}
