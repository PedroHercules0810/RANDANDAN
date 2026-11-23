import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import {
  DescribeTableCommand,
  DynamoDBClient,
  ListTablesCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';

const REGION = process.env.AWS_REGION || 'us-east-1';
const dynamo = new DynamoDBClient({ region: REGION });

let cachedTableSchema = null;

async function resolveDynamoTableSchema() {
  if (cachedTableSchema) return cachedTableSchema;

  let tableName =
    process.env.DYNAMODB_TABLE_NAME ||
    process.env.DYNAMODB_TABLE ||
    process.env.TABLE_NAME ||
    '';

  if (!tableName) {
    try {
      const { TableNames } = await dynamo.send(new ListTablesCommand({}));
      if (Array.isArray(TableNames) && TableNames.length > 0) {
        const preferred = TableNames.find((name) =>
          /profile|user|randandan|pilot|chat/i.test(name),
        );
        tableName = preferred || TableNames[0];
      }
    } catch (err) {
      console.warn('[RANDANDAN Lambda] Aviso ao listar tabelas DynamoDB:', err?.message || err);
    }
  }

  if (!tableName) {
    tableName = 'profile';
  }

  let hashKeyName = process.env.DYNAMODB_PK_NAME || 'username';
  let rangeKeyName = null;
  let rangeKeyType = 'S';

  try {
    const { Table } = await dynamo.send(new DescribeTableCommand({ TableName: tableName }));
    const keySchema = Table?.KeySchema || [];
    const attrDefs = Table?.AttributeDefinitions || [];

    const hashEntry = keySchema.find((k) => k.KeyType === 'HASH');
    if (hashEntry?.AttributeName) hashKeyName = hashEntry.AttributeName;

    const rangeEntry = keySchema.find((k) => k.KeyType === 'RANGE');
    if (rangeEntry?.AttributeName) {
      rangeKeyName = rangeEntry.AttributeName;
      const def = attrDefs.find((a) => a.AttributeName === rangeKeyName);
      if (def?.AttributeType) rangeKeyType = def.AttributeType;
    }
  } catch (err) {
    console.warn(`[RANDANDAN Lambda] Aviso DescribeTable (${tableName}):`, err?.message || err);
  }

  cachedTableSchema = { tableName, hashKeyName, rangeKeyName, rangeKeyType };
  return cachedTableSchema;
}

async function appendChatTurnToDynamoDB(username, userText, modelReplyText, timestampIso) {
  if (!username) return;
  try {
    const schema = await resolveDynamoTableSchema();
    const key = { [schema.hashKeyName]: { S: String(username) } };
    if (schema.rangeKeyName) {
      key[schema.rangeKeyName] = schema.rangeKeyType === 'N' ? { N: '0' } : { S: 'profile' };
    }

    const newMessages = [
      {
        M: {
          id: { S: `user-${Date.now()}` },
          role: { S: 'user' },
          sender: { S: String(username) },
          text: { S: String(userText) },
          timestamp: { S: timestampIso },
        },
      },
      {
        M: {
          id: { S: `model-${Date.now() + 1}` },
          role: { S: 'model' },
          sender: { S: 'Chefe de Box (Google Gemini)' },
          text: { S: String(modelReplyText) },
          timestamp: { S: timestampIso },
        },
      },
    ];

    await dynamo.send(
      new UpdateItemCommand({
        TableName: schema.tableName,
        Key: key,
        UpdateExpression:
          'SET messages = list_append(if_not_exists(messages, :empty_list), :new_msgs), updatedAt = :u',
        ExpressionAttributeValues: {
          ':empty_list': { L: [] },
          ':new_msgs': { L: newMessages },
          ':u': { S: timestampIso },
        },
      }),
    );
    console.log(
      `[RANDANDAN Lambda] Mensagens salvas no DynamoDB (tabela=${schema.tableName}, ${schema.hashKeyName}="${username}")`,
    );
    return true;
  } catch (err) {
    console.warn('[RANDANDAN Lambda] Falha ao salvar mensagens no DynamoDB:', err?.message || err);
    return false;
  }
}

const MOTORCYCLES_CATALOG = [
  { manufacturer: 'Honda', model: 'CBR 1000RR-R Fireblade', displacementCc: 1000, weightKg: 201, style: 'Sport', fipePrice: 'R$ 189.900', topSpeedKmh: 299 },
  { manufacturer: 'Honda', model: 'CBR 650R', displacementCc: 649, weightKg: 208, style: 'Sport', fipePrice: 'R$ 56.900', topSpeedKmh: 225 },
  { manufacturer: 'Honda', model: 'CB 650R', displacementCc: 649, weightKg: 202, style: 'Naked', fipePrice: 'R$ 53.800', topSpeedKmh: 220 },
  { manufacturer: 'Honda', model: 'CB 500F', displacementCc: 471, weightKg: 189, style: 'Naked', fipePrice: 'R$ 41.500', topSpeedKmh: 185 },
  { manufacturer: 'Honda', model: 'CB 500X', displacementCc: 471, weightKg: 199, style: 'Trail', fipePrice: 'R$ 44.600', topSpeedKmh: 182 },
  { manufacturer: 'Honda', model: 'CB 300F Twister', displacementCc: 293, weightKg: 139, style: 'Street', fipePrice: 'R$ 24.490', topSpeedKmh: 155 },
  { manufacturer: 'Honda', model: 'CG 160 Titan', displacementCc: 162, weightKg: 117, style: 'Street', fipePrice: 'R$ 18.890', topSpeedKmh: 128 },
  { manufacturer: 'Honda', model: 'XRE 300 Sahara', displacementCc: 293, weightKg: 147, style: 'Trail', fipePrice: 'R$ 29.590', topSpeedKmh: 148 },
  { manufacturer: 'Honda', model: 'CRF 1100L Africa Twin', displacementCc: 1084, weightKg: 226, style: 'Trail', fipePrice: 'R$ 92.900', topSpeedKmh: 210 },
  { manufacturer: 'Yamaha', model: 'YZF-R1', displacementCc: 998, weightKg: 201, style: 'Sport', fipePrice: 'R$ 138.900', topSpeedKmh: 299 },
  { manufacturer: 'Yamaha', model: 'YZF-R3', displacementCc: 321, weightKg: 171, style: 'Sport', fipePrice: 'R$ 34.890', topSpeedKmh: 188 },
  { manufacturer: 'Yamaha', model: 'YZF-R15', displacementCc: 155, weightKg: 141, style: 'Sport', fipePrice: 'R$ 21.790', topSpeedKmh: 145 },
  { manufacturer: 'Yamaha', model: 'MT-09', displacementCc: 890, weightKg: 189, style: 'Naked', fipePrice: 'R$ 61.990', topSpeedKmh: 235 },
  { manufacturer: 'Yamaha', model: 'MT-07', displacementCc: 689, weightKg: 184, style: 'Naked', fipePrice: 'R$ 48.990', topSpeedKmh: 214 },
  { manufacturer: 'Yamaha', model: 'MT-03', displacementCc: 321, weightKg: 169, style: 'Naked', fipePrice: 'R$ 32.690', topSpeedKmh: 180 },
  { manufacturer: 'Yamaha', model: 'Fazer FZ25', displacementCc: 249, weightKg: 149, style: 'Street', fipePrice: 'R$ 23.490', topSpeedKmh: 142 },
  { manufacturer: 'Yamaha', model: 'Lander 250', displacementCc: 249, weightKg: 153, style: 'Trail', fipePrice: 'R$ 26.890', topSpeedKmh: 138 },
  { manufacturer: 'Yamaha', model: 'Tracer 900 GT', displacementCc: 847, weightKg: 215, style: 'Touring', fipePrice: 'R$ 69.490', topSpeedKmh: 225 },
  { manufacturer: 'Kawasaki', model: 'Ninja ZX-10R', displacementCc: 998, weightKg: 207, style: 'Sport', fipePrice: 'R$ 119.990', topSpeedKmh: 299 },
  { manufacturer: 'Kawasaki', model: 'Ninja ZX-6R', displacementCc: 636, weightKg: 198, style: 'Sport', fipePrice: 'R$ 77.990', topSpeedKmh: 260 },
  { manufacturer: 'Kawasaki', model: 'Ninja 650', displacementCc: 649, weightKg: 193, style: 'Sport', fipePrice: 'R$ 49.990', topSpeedKmh: 212 },
  { manufacturer: 'Kawasaki', model: 'Ninja 400', displacementCc: 399, weightKg: 168, style: 'Sport', fipePrice: 'R$ 36.490', topSpeedKmh: 195 },
  { manufacturer: 'Kawasaki', model: 'Z900', displacementCc: 948, weightKg: 212, style: 'Naked', fipePrice: 'R$ 63.990', topSpeedKmh: 245 },
  { manufacturer: 'Kawasaki', model: 'Z650', displacementCc: 649, weightKg: 188, style: 'Naked', fipePrice: 'R$ 47.490', topSpeedKmh: 210 },
  { manufacturer: 'Kawasaki', model: 'Z400', displacementCc: 399, weightKg: 167, style: 'Naked', fipePrice: 'R$ 34.490', topSpeedKmh: 188 },
  { manufacturer: 'Kawasaki', model: 'Versys 650', displacementCc: 649, weightKg: 219, style: 'Touring', fipePrice: 'R$ 55.990', topSpeedKmh: 200 },
  { manufacturer: 'Suzuki', model: 'Hayabusa 1300', displacementCc: 1340, weightKg: 264, style: 'Sport', fipePrice: 'R$ 124.500', topSpeedKmh: 299 },
  { manufacturer: 'Suzuki', model: 'GSX-S1000', displacementCc: 999, weightKg: 214, style: 'Naked', fipePrice: 'R$ 79.900', topSpeedKmh: 250 },
  { manufacturer: 'Suzuki', model: 'GSX-S750', displacementCc: 749, weightKg: 213, style: 'Naked', fipePrice: 'R$ 54.900', topSpeedKmh: 230 },
  { manufacturer: 'Suzuki', model: 'V-Strom 650 XT', displacementCc: 645, weightKg: 216, style: 'Trail', fipePrice: 'R$ 56.900', topSpeedKmh: 195 },
  { manufacturer: 'BMW', model: 'S 1000 RR', displacementCc: 999, weightKg: 197, style: 'Sport', fipePrice: 'R$ 129.900', topSpeedKmh: 303 },
  { manufacturer: 'BMW', model: 'R 1250 GS', displacementCc: 1254, weightKg: 249, style: 'Trail', fipePrice: 'R$ 112.900', topSpeedKmh: 219 },
  { manufacturer: 'BMW', model: 'F 850 GS', displacementCc: 853, weightKg: 229, style: 'Trail', fipePrice: 'R$ 74.500', topSpeedKmh: 204 },
  { manufacturer: 'BMW', model: 'G 310 R', displacementCc: 313, weightKg: 164, style: 'Naked', fipePrice: 'R$ 34.900', topSpeedKmh: 143 },
  { manufacturer: 'Ducati', model: 'Panigale V4 S', displacementCc: 1103, weightKg: 195, style: 'Sport', fipePrice: 'R$ 169.900', topSpeedKmh: 305 },
  { manufacturer: 'Ducati', model: 'Monster 937', displacementCc: 937, weightKg: 188, style: 'Naked', fipePrice: 'R$ 86.900', topSpeedKmh: 230 },
  { manufacturer: 'Triumph', model: 'Street Triple 765 RS', displacementCc: 765, weightKg: 188, style: 'Naked', fipePrice: 'R$ 68.990', topSpeedKmh: 240 },
  { manufacturer: 'Triumph', model: 'Tiger 900 Rally', displacementCc: 888, weightKg: 222, style: 'Touring', fipePrice: 'R$ 79.990', topSpeedKmh: 205 },
  { manufacturer: 'KTM', model: '390 Duke', displacementCc: 373, weightKg: 171, style: 'Naked', fipePrice: 'R$ 35.990', topSpeedKmh: 175 },
];

const CORS_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const GEMINI_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
];

function isMiss(status) {
  return status === 'incorrect' || status === 'wrong';
}

function filterCandidateMotorcycles(guesses = [], hints = {}) {
  return MOTORCYCLES_CATALOG.filter((candidate) => {
    for (const g of guesses) {
      if (!g || !g.motorcycle) continue;
      const guessed = g.motorcycle;
      if (isMiss(g.modelStatus) && candidate.model === guessed.model) return false;
      if (g.manufacturerStatus === 'correct' && candidate.manufacturer !== guessed.manufacturer) return false;
      if (isMiss(g.manufacturerStatus) && candidate.manufacturer === guessed.manufacturer) return false;
      if (g.styleStatus === 'correct' && candidate.style !== guessed.style) return false;
      if (isMiss(g.styleStatus) && candidate.style === guessed.style) return false;
      if (g.displacementStatus === 'correct' && candidate.displacementCc !== guessed.displacementCc) return false;
      if (g.displacementStatus === 'higher' && !(candidate.displacementCc < guessed.displacementCc)) return false;
      if (g.displacementStatus === 'lower' && !(candidate.displacementCc > guessed.displacementCc)) return false;
      if (g.weightStatus === 'correct' && candidate.weightKg !== guessed.weightKg) return false;
      if (g.weightStatus === 'higher' && !(candidate.weightKg < guessed.weightKg)) return false;
      if (g.weightStatus === 'lower' && !(candidate.weightKg > guessed.weightKg)) return false;
    }
    if (hints?.fipePrice && candidate.fipePrice !== hints.fipePrice) return false;
    if (hints?.topSpeedKmh && candidate.topSpeedKmh !== Number(hints.topSpeedKmh)) return false;
    return true;
  });
}

function buildFallbackMechanicReply(userMessage, candidates, guesses) {
  if (candidates.length === 0) {
    return 'Fala, piloto! Analisando a telemetria aqui no box, nenhuma moto do catálogo combinou exatamente com esse filtro. Revise as setas de Cilindrada (cc) e Peso (kg) no painel!';
  }
  const brands = [...new Set(candidates.map((m) => m.manufacturer))];
  const styles = [...new Set(candidates.map((m) => m.style))];
  const minCc = Math.min(...candidates.map((m) => m.displacementCc));
  const maxCc = Math.max(...candidates.map((m) => m.displacementCc));
  const sampleModels = candidates
    .slice(0, 5)
    .map((m) => `${m.manufacturer} ${m.model} (${m.style}, ${m.displacementCc}cc, ${m.weightKg}kg)`)
    .join('; ');
  const bestNextGuess = candidates[Math.floor(candidates.length / 2)];

  return [
    `🏍️ Fala, piloto! Analisei sua pergunta ("${userMessage}") cruzando com os seus ${guesses.length} palpite(s) na telemetria do RANDANDAN:`,
    `• Restam ${candidates.length} motocicleta(s) compatíveis no catálogo, entre as marcas [${brands.join(', ')}] e estilos [${styles.join(', ')}], na faixa de ${minCc}cc a ${maxCc}cc.`,
    `• Modelos compatíveis: ${sampleModels}.`,
    `💡 Dica do Chefe de Box: um excelente próximo palpite para dividir as opções ao meio é a ${bestNextGuess.manufacturer} ${bestNextGuess.model} (${bestNextGuess.displacementCc}cc, ${bestNextGuess.weightKg}kg, ${bestNextGuess.style})!`,
  ].join('\n');
}

const SYSTEM_INSTRUCTION = `
Você é o "Chefe de Box RANDANDAN", o mecânico e engenheiro de pista especialista em motocicletas do jogo RANDANDAN.
Sua missão é ajudar o jogador a deduzir a moto secreta dando dicas inteligentes, analisando os chutes anteriores e tirando dúvidas sobre fichas técnicas.
Você NÃO SABE qual é a moto secreta do dia ou da rodada.
Responda sempre em português brasileiro (pt-BR), de forma concisa (máximo de 2 parágrafos curtos), animada e com vocabulário motociclístico.
`.trim();

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout de ${ms}ms atingido em ${label}`)), ms),
    ),
  ]);
}

async function callGeminiWithFallback(apiKey, contents) {
  let lastErr = null;

  for (const model of GEMINI_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const generationConfig = {
        temperature: 0.5,
        maxOutputTokens: 500,
      };
      if (model.startsWith('gemini-2.5')) {
        generationConfig.thinkingConfig = { thinkingBudget: 0 };
      }

      const res = await withTimeout(
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
            contents,
            generationConfig,
          }),
        }),
        4500,
        `Gemini ${model}`,
      );

      const data = await res.json();
      if (!res.ok) {
        lastErr = new Error(data?.error?.message || `HTTP ${res.status}`);
        console.warn(`[RANDANDAN Lambda] ${model} falhou:`, lastErr.message);
        continue;
      }

      const text = data?.candidates?.[0]?.content?.parts
        ?.filter((p) => !p?.thought)
        ?.map((p) => p?.text || '')
        .join('')
        .trim();

      if (text) {
        console.log(`[RANDANDAN Lambda] Respondido por ${model}`);
        return { text, source: model };
      }
    } catch (err) {
      lastErr = err;
      console.warn(`[RANDANDAN Lambda] Timeout/erro em ${model}:`, err?.message || err);
    }
  }

  throw lastErr || new Error('Modelos indisponíveis');
}

async function postToWebSocketConnection(event, payload) {
  const connectionId = event?.requestContext?.connectionId;
  if (!connectionId) return false;

  const stage = event?.requestContext?.stage;
  const apiId = event?.requestContext?.apiId;
  const domainName = event?.requestContext?.domainName;
  const region = process.env.AWS_REGION || 'us-east-1';

  const endpoint =
    apiId && stage
      ? `https://${apiId}.execute-api.${region}.amazonaws.com/${stage}`
      : `https://${domainName}/${stage}`;

  const dataBuffer = Buffer.from(JSON.stringify(payload), 'utf-8');

  try {
    const client = new ApiGatewayManagementApiClient({ region, endpoint });
    await withTimeout(
      client.send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: dataBuffer })),
      3000,
      `PostToConnection (${endpoint})`,
    );
    console.log(`[RANDANDAN Lambda] Enviado via ${endpoint} para connectionId=${connectionId}`);
    return true;
  } catch (err) {
    console.warn(`[RANDANDAN Lambda] PostToConnection (${endpoint}) falhou:`, err?.message || err);
    return false;
  }
}

export const handler = async (event) => {
  console.log('[RANDANDAN Lambda] Evento recebido:', JSON.stringify(event));

  const routeKey = event?.requestContext?.routeKey;
  const connectionId = event?.requestContext?.connectionId;

  if (routeKey === '$connect' || routeKey === '$disconnect') {
    return { statusCode: 200, body: 'OK' };
  }

  let rawBody = {};
  if (typeof event?.body === 'string') {
    try { rawBody = JSON.parse(event.body); } catch { rawBody = { message: event.body }; }
  } else if (event?.body && typeof event.body === 'object') {
    rawBody = event.body;
  }

  const userMessage = String(rawBody.message || rawBody.prompt || 'Me dê uma dica sobre a moto secreta!').trim();
  const username = String(rawBody.username || event?.queryStringParameters?.username || '').trim();
  const guesses = Array.isArray(rawBody.guesses) ? rawBody.guesses : [];
  const hints = rawBody.hints || {};
  const history = Array.isArray(rawBody.history) ? rawBody.history : [];

  const candidates = filterCandidateMotorcycles(guesses, hints);
  const gameContextText = [
    `Tentativas feitas: ${guesses.length}/6.`,
    `Motos compatíveis restantes (${candidates.length}/${MOTORCYCLES_CATALOG.length}):`,
    candidates.map((m) => `- ${m.manufacturer} ${m.model} (${m.style}, ${m.displacementCc}cc, ${m.weightKg}kg)`).join('\n'),
  ].join('\n');

  const contents = [
    ...history
      .filter((item) => item && item.text && (item.role === 'user' || item.role === 'model'))
      .map((item) => ({ role: item.role, parts: [{ text: String(item.text) }] })),
    { role: 'user', parts: [{ text: `${gameContextText}\n\nPERGUNTA DO JOGADOR: ${userMessage}` }] },
  ];

  let reply = '';
  let source = 'fallback-mechanic';
  const apiKey = process.env.GEMINI_API_KEY;

  if (apiKey) {
    try {
      const res = await withTimeout(callGeminiWithFallback(apiKey, contents), 9000, 'GeminiTotal');
      reply = res.text;
      source = res.source;
    } catch (err) {
      console.warn('[RANDANDAN Lambda] Fallback ativado:', err?.message || err);
      reply = buildFallbackMechanicReply(userMessage, candidates, guesses);
    }
  } else {
    reply = buildFallbackMechanicReply(userMessage, candidates, guesses);
  }

  const timestampIso = new Date().toISOString();
  let savedToDynamo = false;

  // Salva a mensagem do usuário e a resposta do agente de IA na lista do DynamoDB (chave principal = nome do usuário)
  if (username) {
    savedToDynamo = await withTimeout(
      appendChatTurnToDynamoDB(username, userMessage, reply, timestampIso),
      2500,
      'DynamoDBAppendChat',
    ).catch(() => false);
  }

  const responsePayload = {
    type: 'chat_reply',
    username: username || undefined,
    question: userMessage,
    reply,
    source,
    savedToDynamo,
    candidatesRemaining: candidates.length,
    zeroScore: true,
    scoreMultiplier: 0,
    timestamp: timestampIso,
  };

  console.log('[RANDANDAN Lambda] Resposta processada:', JSON.stringify(responsePayload));

  if (connectionId) {
    await postToWebSocketConnection(event, responsePayload);
  }

  return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(responsePayload) };
};
