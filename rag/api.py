from typing import List, Optional
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
import requests
from query_rag import ask, retrieve

app = FastAPI(title="DENT RAG API")

# --- RAG endpoints ---

class QueryRequest(BaseModel):
    question: str
    top_k: Optional[int] = None

class Fragmento(BaseModel):
    tabla: str
    texto: str
    distancia: float

class QueryResponse(BaseModel):
    respuesta: str
    fragmentos: List[Fragmento]

class RetrieveResponse(BaseModel):
    fragmentos: List[Fragmento]

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/query", response_model=QueryResponse)
def query(req: QueryRequest):
    k = req.top_k or 5
    try:
        answer, hits = ask(req.question, k)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Error consultando Ollama/Chroma: {e}")
    fragmentos = [
        {"tabla": id_, "texto": doc, "distancia": round(float(dist), 4)}
        for id_, doc, dist in hits
    ]
    return {"respuesta": answer, "fragmentos": fragmentos}

@app.post("/retrieve", response_model=RetrieveResponse)
def retrieve_endpoint(req: QueryRequest):
    k = req.top_k or 5
    try:
        hits = retrieve(req.question, k)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Error consultando Ollama/Chroma: {e}")
    fragmentos = [
        {"tabla": id_, "texto": doc, "distancia": round(float(dist), 4)}
        for id_, doc, dist in hits
    ]
    return {"fragmentos": fragmentos}


# --- Test harness del agente n8n ---

N8N_WEBHOOK_URL = "https://n8n.ino.cl/webhook/pregunta"

class AgentTestRequest(BaseModel):
    question: str
    user_email: str = "informatica@ino.cl"

@app.post("/run-agent")
def run_agent(req: AgentTestRequest):
    try:
        resp = requests.post(
            N8N_WEBHOOK_URL,
            json={"question": req.question, "user_email": req.user_email},
            timeout=120,
        )
        try:
            data = resp.json()
        except ValueError:
            data = {"raw_text": resp.text}
        return {"status_code": resp.status_code, "response": data}
    except requests.RequestException as e:
        return {"status_code": 0, "response": {"error": str(e)}}


# --- Ejecutar SQL directo contra DentWeb ---

DENTWEB_URL = "http://sistema.ino.cl/DentWeb12/dent/rest/queryGptJson.jsp"
DENTWEB_TOKEN = "987654321"

class SqlTestRequest(BaseModel):
    sql: str
    user_email: str = "informatica@ino.cl"

@app.post("/run-sql")
def run_sql(req: SqlTestRequest):
    try:
        resp = requests.get(
            DENTWEB_URL,
            params={
                "query": req.sql,
                "token": DENTWEB_TOKEN,
                "fromApp": "PYTHON_TEST",
                "fromModulo": "sql_manual",
                "usuario": req.user_email,
                "cns": "sql manual",
            },
            timeout=60,
        )
        try:
            data = resp.json()
        except ValueError:
            data = {"raw_text": resp.text}
        return {"status_code": resp.status_code, "response": data}
    except requests.RequestException as e:
        return {"status_code": 0, "response": {"error": str(e)}}


INDEX_HTML = r"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Tester Agente IA - DENT</title>
<style>
  body { font-family: -apple-system, Arial, sans-serif; background:#111; color:#eee; margin:0; padding:24px; }
  h1 { font-size:20px; }
  h2 { font-size:16px; margin-top:40px; border-top:1px solid #333; padding-top:24px; }
  textarea, input { width:100%; box-sizing:border-box; background:#1c1c1c; color:#eee; border:1px solid #333; border-radius:6px; padding:8px; font-size:14px; }
  textarea { height:80px; }
  button { background:#e8642c; color:#fff; border:none; padding:10px 18px; border-radius:6px; cursor:pointer; font-size:14px; margin-top:8px; }
  button:disabled { opacity:0.5; }
  pre { background:#1c1c1c; border:1px solid #333; border-radius:6px; padding:12px; overflow:auto; white-space:pre-wrap; word-break:break-word; font-size:13px; }
  .label { font-size:12px; color:#999; margin-top:12px; display:block; }
  .status-ok { color:#5ee08c; }
  .status-bad { color:#ff6b6b; }
  .col { max-width:900px; }
</style>
</head>
<body>

<h1>Tester Agente IA — DENT</h1>

<div class="col">
  <label class="label">Pregunta</label>
  <textarea id="question">dame total de pacientes del dia de hoy</textarea>
  <label class="label">Email usuario</label>
  <input id="user_email" value="informatica@ino.cl">
  <button id="btnRun" onclick="ejecutar()">Ejecutar</button>
  <span id="timer" style="margin-left:12px;color:#999;"></span>

  <label class="label">Resultado de n8n</label>
  <pre id="rawOut">(nada todavia)</pre>
</div>

<div class="col">
  <h2>Ejecutar SQL directo (GET a DentWeb)</h2>
  <label class="label">SQL</label>
  <textarea id="sqlInput" style="height:100px;">SELECT COUNT(DISTINCT COD_PACIENTE) AS TOTAL_PACIENTES FROM DENT.AGENDA WHERE TRUNC(FEC_CITA) = TRUNC(SYSDATE)</textarea>
  <button id="btnSql" onclick="ejecutarSql()">Ejecutar SQL</button>
  <span id="timerSql" style="margin-left:12px;color:#999;"></span>

  <label class="label">Resultado</label>
  <pre id="sqlOut">(nada todavia)</pre>
</div>

<script>
async function ejecutar() {
  const btn = document.getElementById('btnRun');
  const timer = document.getElementById('timer');
  const rawOut = document.getElementById('rawOut');
  const question = document.getElementById('question').value;
  const user_email = document.getElementById('user_email').value;

  btn.disabled = true;
  rawOut.textContent = 'Ejecutando...';
  const start = Date.now();

  try {
    const resp = await fetch('/run-agent', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({question, user_email})
    });
    const data = await resp.json();
    const elapsed = ((Date.now() - start) / 1000).toFixed(2);
    timer.textContent = elapsed + 's - HTTP ' + data.status_code;
    timer.className = (data.status_code >= 200 && data.status_code < 300) ? 'status-ok' : 'status-bad';
    rawOut.textContent = JSON.stringify(data.response, null, 2);
  } catch (e) {
    rawOut.textContent = 'Error: ' + e;
  } finally {
    btn.disabled = false;
  }
}

async function ejecutarSql() {
  const btn = document.getElementById('btnSql');
  const timer = document.getElementById('timerSql');
  const sqlOut = document.getElementById('sqlOut');
  const sql = document.getElementById('sqlInput').value;
  const user_email = document.getElementById('user_email').value;

  btn.disabled = true;
  sqlOut.textContent = 'Ejecutando...';
  const start = Date.now();

  try {
    const resp = await fetch('/run-sql', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({sql, user_email})
    });
    const data = await resp.json();
    const elapsed = ((Date.now() - start) / 1000).toFixed(2);
    timer.textContent = elapsed + 's - HTTP ' + data.status_code;
    timer.className = (data.status_code >= 200 && data.status_code < 300) ? 'status-ok' : 'status-bad';
    sqlOut.textContent = JSON.stringify(data.response, null, 2);
  } catch (e) {
    sqlOut.textContent = 'Error: ' + e;
  } finally {
    btn.disabled = false;
  }
}
</script>
</body>
</html>
"""

@app.get("/", response_class=HTMLResponse)
def index():
    return INDEX_HTML
