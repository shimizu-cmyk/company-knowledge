async function askAI(question){

const res = await fetch("/json/search-index.json")
const data = await res.json()

let context = ""

data.forEach(item=>{
if(
item.title.includes(question) ||
item.text.includes(question)
){
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
