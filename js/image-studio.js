const API_ENDPOINT="/api/image-generate";

async function generateImage(){

  const prompt=document.getElementById("prompt").value.trim();
  const mode=document.getElementById("mode").value;
  const provider=document.getElementById("provider").value;
  const button=document.getElementById("generateBtn");
  const result=document.getElementById("result");

  if(!prompt && mode==="generate"){
    alert("Enter an image description first.");
    return;
  }

  button.disabled=true;
  button.textContent="Generating...";
  result.innerHTML=`
    <div class="form-card">
      <p>Creating your image...</p>
    </div>
  `;

  try{

    const response=await fetch(API_ENDPOINT,{
      method:"POST",
      headers:{
        "Content-Type":"application/json"
      },
      body:JSON.stringify({
        prompt,
        mode,
        provider
      })
    });

    const data=await response.json();

    if(!response.ok){
      throw new Error(data.error||"Generation failed");
    }

    result.innerHTML=`
      <div class="form-card" style="max-width:760px">
        <img
          src="${data.image}"
          alt="Generated image"
          style="width:100%;border-radius:16px;display:block"
        >

        <div style="margin-top:14px">
          <a
            href="${data.image}"
            download="grandwave-image.png"
            class="btn"
            style="display:inline-block;text-decoration:none">
            Download
          </a>
        </div>
      </div>
    `;

    updateUsage();

  }catch(error){

    result.innerHTML=`
      <div class="form-card">
        <p style="color:#D9503F">
          ${escapeHTML(error.message)}
        </p>
      </div>
    `;

  }finally{

    button.disabled=false;
    button.textContent="Generate Image";

  }
}

function updateUsage(){
  const usage=document.getElementById("usage");
  usage.textContent="Generation used. Remaining limit will be synced with your account.";
}

function escapeHTML(value){
  const div=document.createElement("div");
  div.textContent=value;
  return div.innerHTML;
}
