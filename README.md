# 内部审计法规智能匹配（论文配套代码与数据）

《融合检索增强生成与思维链的内部审计法规匹配方法》的复现材料。方法以本地部署的 8B 大模型为底座，用「检索增强生成（RAG）+ 两阶段思维链（CoT）」把审计问题定位到具体的法规条款，全过程不产生外部网络请求。

## 目录

```
.
├── data/
│   ├── eval138_anon.json   138 条评测问题（已脱敏）
│   ├── prompts.md          提示词模板与两阶段思维链
│   └── README.md           数据说明与获取方式
├── code/                   检索、推理、评测脚本（Node.js ESM）
└── docs/results.md         论文报告的主要指标
```

## 环境

| 用途 | 依赖 |
| --- | --- |
| 脚本运行 | Node.js ≥ 18（原生 fetch、ESM），无第三方包 |
| 模型 | 任意兼容 OpenAI 接口的对话/嵌入服务；论文实验使用阿里云百炼 `qwen3.8-max` 与 `text-embedding-v3` |

## 目录约定

脚本沿用实验时的相对路径，运行前请在工作目录下建好：

```
_exp/            中间数据与模型输出（脚本自动创建）
_parsed/text/    法规全文，每份法规一个 .txt
_secrets/bailian.csv   第一行为 apiKey,<你的密钥>；另需 openAiCompatible,<接口地址>
```

把 `data/eval138_anon.json` 复制为 `_exp/eval138.json` 即可直接跑评测脚本。

## 快速开始

```bash
# 1 法规语料切片与向量化
node code/chunk_corpus.mjs          # _parsed/text -> _exp/corpus_chunks.jsonl
node code/embed_corpus.mjs          # 生成语料向量
node code/embed_questions.mjs       # 生成问题向量

# 2 检索器对比（对应论文表 4、图 4）
node code/eval_bm25.mjs
node code/eval_dense.mjs
node code/eval_hybrid.mjs
node code/eval_instruct.mjs

# 3 端到端推理
node code/retrieve_bm25_top20.mjs   # 取 BM25 Top-20 候选
node code/run_bm25_rag.mjs          # 证据注入 + 七参数提示词
node code/run_llm3.mjs              # 零样本 / 两阶段 RAG 对照

# 4 评测与显著性
node code/eval_jsonl.mjs _exp/llm5_bm25rag_qwen3_8_max_k5.jsonl bm25_rag
node code/compare_mcnemar.mjs _exp/A.jsonl modeA _exp/B.jsonl modeB
```

## 主要结果

详见 [`docs/results.md`](docs/results.md)。要点：138 条真实审计问题上，文件级命中率 36.23% → 80.43%，条款级 1.45% → 21.74%，加权正确率 22.32% → 56.96%（P<0.001）；消融实验表明单独引入知识库、提示词或思维链均不显著，融合 RAG 才是性能提升的关键。

## 数据与合规

- **评测集已脱敏**：四组问题来源分别记为甲校、乙校、丙校与专项测试集；企业名称记为「某公司」，校区与地名记为「某校区」「某市」，金额替换为 `***万元`。原始数据涉及真实审计底稿，不公开。
- **法规语料不随仓库分发**：共 1 285 份、约 822 万字符，其中单位内部制度属内部资料。公开法规部分可自行从审计署、财政部等公开渠道获取，`data/README.md` 给出了来源清单与预处理要点。
- **不含任何密钥**：`.gitignore` 已排除 `_secrets/`。

## 引用

```
申艳, 肖宏彬, 李智, 李建毅, 谭舒孺. 融合检索增强生成与思维链的内部审计法规匹配方法[J].
广西师范大学学报(自然科学版), 2026.
```

## 许可

代码 MIT；`data/eval138_anon.json` 与文档 CC BY 4.0。
