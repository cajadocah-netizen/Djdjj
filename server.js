const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const arquivo = path.join(__dirname, "dados.json");
const segredo = process.env.JWT_SECRET;

if (!segredo) {
console.error("Configure a variável JWT_SECRET no Render.");
process.exit(1);
}

function carregar() {
try {
return JSON.parse(fs.readFileSync(arquivo, "utf8"));
} catch {
return { users: [] };
}
}

function salvar(dados) {
fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2));
}

function tokenDe(usuario) {
return jwt.sign({ username: usuario }, segredo, {
expiresIn: "7d"
});
}

function autenticacao(req, res, next) {
try {
const cabecalho = req.headers.authorization || "";
const token = cabecalho.replace(/^Bearer /, "");
req.usuario = jwt.verify(token, segredo).username;
next();
} catch {
res.status(401).json({ erro: "Faça login novamente." });
}
}

function iniciar() {
const dados = carregar();
if (!dados.users.some(u => u.username === "riquinho")) {
dados.users.push({
username: "riquinho",
password: bcrypt.hashSync("Heitor24", 10),
brl: 250000,
usd: 0,
caixinhas: [],
extrato: [{
data: new Date().toISOString(),
descricao: "Saldo inicial demonstrativo",
valor: 250000,
moeda: "BRL"
}]
});
salvar(dados);
}
}

app.get("/", (req, res) => {
res.json({ status: "Servidor funcionando", demonstracao: true });
});

app.post("/api/register", async (req, res) => {
const username = String(req.body.username || "").trim().toLowerCase();
const password = String(req.body.password || "");

if (!/^[a-z0-9_]{3,20}$/.test(username) ||
password.length < 6 || password.length > 20) {
return res.status(400).json({
erro: "Usuário: 3 a 20 letras/números. Senha: 6 a 20 caracteres."
});
}

const dados = carregar();
if (dados.users.some(u => u.username === username)) {
return res.status(409).json({ erro: "Usuário já existe." });
}

dados.users.push({
username,
password: await bcrypt.hash(password, 10),
brl: 0,
usd: 0,
caixinhas: [],
extrato: []
});
salvar(dados);
res.status(201).json({ token: tokenDe(username), username });
});

app.post("/api/login", async (req, res) => {
const username = String(req.body.username || "").trim().toLowerCase();
const password = String(req.body.password || "");
const usuario = carregar().users.find(u => u.username === username);

if (!usuario || !(await bcrypt.compare(password, usuario.password))) {
return res.status(401).json({ erro: "Usuário ou senha incorretos." });
}

res.json({ token: tokenDe(username), username });
});

app.get("/api/me", autenticacao, (req, res) => {
const u = carregar().users.find(x => x.username === req.usuario);
if (!u) return res.status(404).json({ erro: "Conta não encontrada." });

res.json({
username: u.username,
brl: u.brl,
usd: u.usd,
caixinhas: u.caixinhas,
extrato: u.extrato
});
});

app.post("/api/transferir", autenticacao, (req, res) => {
const destinoNome = String(req.body.destino || "").trim().toLowerCase();
const moeda = req.body.moeda === "USD" ? "USD" : "BRL";
const valor = Number(req.body.valor);

if (!Number.isFinite(valor) || valor <= 0 || valor > 1000000) {
return res.status(400).json({ erro: "Valor inválido." });
}

const dados = carregar();
const origem = dados.users.find(u => u.username === req.usuario);
const destino = dados.users.find(u => u.username === destinoNome);

if (!origem || !destino || origem === destino) {
return res.status(400).json({ erro: "Conta de destino inválida." });
}

const campo = moeda === "USD" ? "usd" : "brl";
if (origem[campo] < valor) {
return res.status(400).json({ erro: "Saldo insuficiente." });
}

origem[campo] = Math.round((origem[campo] - valor) * 100) / 100;
destino[campo] = Math.round((destino[campo] + valor) * 100) / 100;

const data = new Date().toISOString();
origem.extrato.push({ data, descricao: "Transferência enviada para " + destinoNome, valor: -valor, moeda });
destino.extrato.push({ data, descricao: "Transferência recebida de " + origem.username, valor, moeda });

salvar(dados);
res.json({ sucesso: true, saldo: origem[campo], moeda });
});

app.post("/api/caixinhas", autenticacao, (req, res) => {
const nome = String(req.body.nome || "").trim().slice(0, 40);
const valor = Number(req.body.valor);
const acao = req.body.acao === "retirar" ? "retirar" : "guardar";

if (!nome || !Number.isFinite(valor) || valor <= 0) {
return res.status(400).json({ erro: "Nome ou valor inválido." });
}

const dados = carregar();
const u = dados.users.find(x => x.username === req.usuario);
let c = u.caixinhas.find(x => x.nome === nome);

if (acao === "guardar") {
if (u.brl < valor) return res.status(400).json({ erro: "Saldo insuficiente." });
if (!c) {
c = { nome, saldo: 0 };
u.caixinhas.push(c);
}
u.brl -= valor;
c.saldo += valor;
} else {
if (!c || c.saldo < valor) return res.status(400).json({ erro: "Saldo insuficiente na caixinha." });
c.saldo -= valor;
u.brl += valor;
}

u.extrato.push({
data: new Date().toISOString(),
descricao: (acao === "guardar" ? "Guardado na caixinha " : "Retirado da caixinha ") + nome,
valor: acao === "guardar" ? -valor : valor,
moeda: "BRL"
});

salvar(dados);
res.json({ sucesso: true, saldo: u.brl, caixinhas: u.caixinhas });
});

iniciar();

const porta = process.env.PORT || 3000;
app.listen(porta, "0.0.0.0", () => {
console.log("Servidor iniciado na porta " + porta);
});
