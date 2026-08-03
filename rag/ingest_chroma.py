import json, requests, chromadb

CHUNKS_FILE = "/home/ino/wacrm/rag/chunks.jsonl"
CHROMA_PATH = "/home/ino/wacrm/rag/chroma_db"
COLLECTION = "dent_dict"
OLLAMA_URL = "http://localhost:11434/api/embed"
MODEL = "qwen3-embedding:0.6b"
BATCH_SIZE = 16

def embed_batch(texts):
    resp = requests.post(OLLAMA_URL, json={"model": MODEL, "input": texts}, timeout=120)
    resp.raise_for_status()
    return resp.json()["embeddings"]

records = []
with open(CHUNKS_FILE, encoding="utf-8") as f:
    for line in f:
        records.append(json.loads(line))

print(f"Registros a vectorizar: {len(records)}")

client = chromadb.PersistentClient(path=CHROMA_PATH)
try:
    client.delete_collection(COLLECTION)
except Exception:
    pass
collection = client.create_collection(name=COLLECTION, metadata={"hnsw:space": "cosine"})

for i in range(0, len(records), BATCH_SIZE):
    batch = records[i:i+BATCH_SIZE]
    texts = [r["text"] for r in batch]
    ids = [r["id"] for r in batch]
    metadatas = [r["metadata"] for r in batch]
    embeddings = embed_batch(texts)
    collection.add(ids=ids, embeddings=embeddings, documents=texts, metadatas=metadatas)
    print(f"  procesados {i+len(batch)}/{len(records)}")

print("Total en colección:", collection.count())

test_emb = embed_batch(["¿en qué tabla se guardan las citas de los pacientes?"])[0]
res = collection.query(query_embeddings=[test_emb], n_results=3)
print("--- Test de búsqueda ---")
for id_, dist in zip(res["ids"][0], res["distances"][0]):
    print(f"  {id_}  (dist={dist:.4f})")
