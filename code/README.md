# 脚本说明

Node.js ESM，无第三方依赖。全部按相对路径读写 `_parsed/`、`_exp/`、`_secrets/`。

## 数据流

```
_parsed/text/*.txt
      │  chunk_corpus.mjs
      ▼
_exp/corpus_chunks.jsonl ──embed_corpus.mjs──▶ 语料向量
                                                      │
_exp/eval138.json ──embed_questions.mjs──▶ 问题向量 ──┤
                                                      ▼
                                          eval_{bm25,dense,hybrid,instruct}.mjs
                                                      │  检索器对比（表 4）
                                                      ▼
                                          retrieve_bm25_top20.mjs
                                                      │  Top-20 候选条文
                                                      ▼
                                          run_bm25_rag.mjs  ──▶ _exp/llm5_*.jsonl
                                          run_llm3.mjs      ──▶ _exp/llm3_*.jsonl
                                          run_fulltext.mjs  ──▶ _exp/llm7_*.jsonl
                                                      │
                                                      ▼
                                          eval_jsonl.mjs / compare_mcnemar.mjs
```

## 文件

| 脚本 | 作用 | 对应论文 |
| --- | --- | --- |
| `chunk_corpus.mjs` | 法规全文切分为条款级片段 | 3.2 节 |
| `embed_corpus.mjs` / `embed_questions.mjs` | 调嵌入接口生成向量 | 3.2 节 |
| `eval_bm25.mjs` | BM25 检索与命中率 | 表 4 |
| `eval_dense.mjs` | 稠密检索（含加指令前缀变体） | 表 4 |
| `eval_hybrid.mjs` | 混合检索（RRF 融合） | 表 4 |
| `eval_instruct.mjs` | 带指令前缀的稠密检索 | 表 4 |
| `retrieve_bm25_top20.mjs` | 取 Top-20 候选，供端到端实验 | 4.4 节 |
| `run_bm25_rag.mjs` | BM25 证据 + 七参数提示词端到端 | 表 6 |
| `run_llm3.mjs` | 零样本 / 两阶段 RAG 对照 | 表 5、表 6 |
| `run_fulltext.mjs` | 整篇法规直塞对照 | 4.4 节末 |
| `run_verify.mjs` | 条款编号二次核验（负结果） | 未写入论文 |
| `eval_jsonl.mjs` | 对任意 jsonl 跑规则比对评测 | 4.2 节 |
| `compare_mcnemar.mjs` | 两组输出逐条配对 McNemar | 4.7 节 |
| `compare_subset.mjs` | 子集上的配置对比 | 4.4 节 |
| `build_eval138.mjs` | 从原始标注构建评测集 | 4.1 节 |

## 配置

`_secrets/bailian.csv`，两行：

```
apiKey,sk-xxxxxxxx
openAiCompatible,https://dashscope.aliyuncs.com/compatible-mode/v1
```

换用其他兼容 OpenAI 接口的服务，只需改这两行；模型名通过环境变量指定，如 `LLM_MODEL=qwen-plus node code/run_llm3.mjs`。
