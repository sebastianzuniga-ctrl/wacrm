import sys, re, requests, chromadb

CHROMA_PATH = "/home/ino/wacrm/rag/chroma_db"
COLLECTION = "dent_dict"
EMBED_MODEL = "qwen3-embedding:0.6b"
CHAT_MODEL = "qwen2.5:7b"
OLLAMA_EMBED_URL = "http://localhost:11434/api/embed"
OLLAMA_CHAT_URL = "http://localhost:11434/api/chat"
TOP_K = 5

def embed(text, retries=2):
    payload = {"model": EMBED_MODEL, "input": text, "keep_alive": "60m"}
    last_exc = None
    for attempt in range(retries):
        try:
            resp = requests.post(OLLAMA_EMBED_URL, json=payload, timeout=120)
            resp.raise_for_status()
            return resp.json()["embeddings"][0]
        except requests.RequestException as e:
            last_exc = e
    raise last_exc

def retrieve(question, k=TOP_K):
    client = chromadb.PersistentClient(path=CHROMA_PATH)
    collection = client.get_collection(COLLECTION)
    q_emb = embed(question)
    res = collection.query(query_embeddings=[q_emb], n_results=k)
    return list(zip(res["ids"][0], res["documents"][0], res["distances"][0]))

def ask(question, k=TOP_K):
    hits = retrieve(question, k)
    contexto = "\n\n".join(doc for _, doc, _ in hits)
    system = (
        "Eres un asistente técnico del sistema DENT (gestión clínica dental). "
        "Responde SOLO basándote en el contexto de tablas entregado abajo. "
        "Si la respuesta no está en el contexto, dilo explícitamente. "
        "Siempre indica el nombre de la(s) tabla(s) relevante(s) en tu respuesta."
    )
    user = f"Contexto (diccionario de datos):\n{contexto}\n\nPregunta: {question}"
    payload = {
        "model": CHAT_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "stream": False,
        "think": False,
        "keep_alive": "60m",
    }
    resp = requests.post(OLLAMA_CHAT_URL, json=payload, timeout=300)
    resp.raise_for_status()
    answer = resp.json()["message"]["content"]
    answer = re.sub(r"<think>.*?</think>", "", answer, flags=re.DOTALL).strip()
    return answer, hits

if __name__ == "__main__":
    question = " ".join(sys.argv[1:]) or input("Pregunta: ")
    answer, hits = ask(question)
    print("=== Tablas recuperadas ===")
    for id_, _, dist in hits:
        print(f"  {id_} (dist={dist:.4f})")
    print("\n=== Respuesta ===")
    print(answer)
