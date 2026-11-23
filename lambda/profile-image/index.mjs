import {
  DescribeTableCommand,
  DynamoDBClient,
  ListTablesCommand,
  ScanCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import {
  GetObjectCommand,
  ListBucketsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const REGION = process.env.AWS_REGION || 'us-east-1';
const s3 = new S3Client({ region: REGION });
const dynamo = new DynamoDBClient({ region: REGION });

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const CORS_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-File-Name, Accept',
};

let cachedBucketName = null;
let cachedTableSchema = null;

async function resolveProfileBucketName() {
  const envBucket =
    process.env.BUCKET_NAME ||
    process.env.PROFILE_BUCKET_NAME ||
    process.env.S3_BUCKET_NAME;

  if (envBucket) return envBucket.trim();
  if (cachedBucketName) return cachedBucketName;

  try {
    const { Buckets } = await s3.send(new ListBucketsCommand({}));
    if (Array.isArray(Buckets) && Buckets.length > 0) {
      const exactMatch = Buckets.find((b) => b.Name?.toLowerCase() === 'profile');
      if (exactMatch?.Name) return (cachedBucketName = exactMatch.Name);

      const partialMatch = Buckets.find((b) => b.Name?.toLowerCase().includes('profile'));
      if (partialMatch?.Name) return (cachedBucketName = partialMatch.Name);
    }
  } catch (err) {
    console.warn('[RANDANDAN Profile Lambda] Aviso ao listar buckets S3:', err?.message || err);
  }
  return 'profile';
}

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
      console.warn('[RANDANDAN Profile Lambda] Aviso ao listar tabelas DynamoDB:', err?.message || err);
    }
  }

  if (!tableName) tableName = 'profile';

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
    console.warn(`[RANDANDAN Profile Lambda] DescribeTable (${tableName}):`, err?.message || err);
  }

  cachedTableSchema = { tableName, hashKeyName, rangeKeyName, rangeKeyType };
  return cachedTableSchema;
}

function buildDynamoKey(schema, username) {
  const key = { [schema.hashKeyName]: { S: String(username) } };
  if (schema.rangeKeyName) {
    key[schema.rangeKeyName] = schema.rangeKeyType === 'N' ? { N: '0' } : { S: 'profile' };
  }
  return key;
}

function parseDynamoMessages(listAttr) {
  if (!listAttr?.L || !Array.isArray(listAttr.L)) return [];
  return listAttr.L.map((item) => {
    const m = item?.M || {};
    return {
      id: m.id?.S || `msg-${Date.now()}`,
      role: m.role?.S || 'model',
      sender: m.sender?.S || '',
      text: m.text?.S || '',
      timestamp: m.timestamp?.S || '',
    };
  }).filter((msg) => msg.text);
}

function toDynamoMessagesList(messages) {
  return messages
    .filter((m) => m && m.text)
    .map((m) => ({
      M: {
        id: { S: String(m.id || `msg-${Date.now()}`) },
        role: { S: String(m.role || 'user') },
        sender: { S: String(m.sender || (m.role === 'model' ? 'Chefe de Box (Google Gemini)' : 'Piloto')) },
        text: { S: String(m.text) },
        timestamp: { S: String(m.timestamp || new Date().toISOString()) },
      },
    }));
}

function parseDynamoScores(listAttr) {
  if (!listAttr?.L || !Array.isArray(listAttr.L)) return [];
  return listAttr.L.map((item) => {
    const s = item?.M || {};
    return {
      userId: s.userId?.S || '',
      date: s.date?.S || new Date().toISOString(),
      guessCount: Number(s.guessCount?.N || 0),
      timeBonus: Number(s.timeBonus?.N || 0),
      hintsUsed: Number(s.hintsUsed?.N || 0),
      totalPoints: Number(s.totalPoints?.N || 0),
      mode: s.mode?.S === 'infinite' ? 'infinite' : 'daily',
    };
  });
}

function toDynamoScoreMap(score, userId) {
  return {
    M: {
      userId: { S: String(score.userId || userId) },
      date: { S: String(score.date || new Date().toISOString()) },
      guessCount: { N: String(Number(score.guessCount || 1)) },
      timeBonus: { N: String(Number(score.timeBonus || 0)) },
      hintsUsed: { N: String(Number(score.hintsUsed || 0)) },
      totalPoints: { N: String(Number(score.totalPoints || 0)) },
      mode: { S: String(score.mode || 'daily') },
    },
  };
}

/**
 * Escaneia todos os pilotos registrados na tabela do DynamoDB para montar o
 * Ranking Global compartilhado entre todos os computadores.
 */
async function scanGlobalRankings(schema) {
  try {
    const { Items } = await dynamo.send(
      new ScanCommand({
        TableName: schema.tableName,
      }),
    );

    if (!Array.isArray(Items)) return [];

    return Items.map((item) => {
      const username = item?.[schema.hashKeyName]?.S || item?.username?.S || item?.name?.S || '';
      const scores = parseDynamoScores(item?.scores);
      const calculatedPoints = scores.reduce((acc, s) => acc + (s.totalPoints || 0), 0);
      const totalPoints =
        item?.totalPoints?.N !== undefined ? Number(item.totalPoints.N) : calculatedPoints;

      return {
        username,
        userId: item?.userId?.S || '',
        email: item?.email?.S || '',
        teamId: item?.teamId?.N ? Number(item.teamId.N) : null,
        teamName: item?.teamName?.S || 'Sem Equipe',
        totalPoints,
        s3Url: item?.s3Url?.S || item?.imageUrl?.S || null,
      };
    }).filter((entry) => Boolean(entry.username));
  } catch (err) {
    console.warn('[RANDANDAN Profile Lambda] Aviso ao escanear ranking global no DynamoDB:', err?.message || err);
    return [];
  }
}

function extractAuthenticatedUser(event, parsedBody = null) {
  const authorizerClaims =
    event?.requestContext?.authorizer?.jwt?.claims ||
    event?.requestContext?.authorizer?.claims ||
    {};

  const authHeader =
    event?.headers?.authorization ||
    event?.headers?.Authorization ||
    event?.queryStringParameters?.token ||
    '';

  let jwtClaims = {};
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (token && token.split('.').length === 3) {
    try {
      const payloadBase64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      jwtClaims = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf-8')) || {};
      if (jwtClaims.exp && Date.now() >= Number(jwtClaims.exp) * 1000) return null;
    } catch {}
  }

  const claims = { ...jwtClaims, ...authorizerClaims };
  const sub = claims.sub;
  if (!sub) return null;

  const email = String(claims.email || claims['cognito:username'] || sub);
  const emailPrefix = email.includes('@') ? email.split('@')[0] : email;
  const explicitUsername = parsedBody?.username || event?.queryStringParameters?.username || '';
  const tokenDisplayName =
    claims.name || claims.given_name || claims.preferred_username || claims.nickname || emailPrefix;

  return {
    userId: String(sub),
    username: String(explicitUsername || tokenDisplayName || sub).trim(),
    email,
  };
}

function sanitizeS3Slug(name) {
  return (
    String(name)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'pilot'
  );
}

function detectImageMimeFromMagicBytes(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return 'image/gif';
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

function parseS3Url(s3Url, defaultBucket) {
  if (!s3Url) return null;
  const trimmed = String(s3Url).trim();
  try {
    const url = new URL(trimmed);
    const hostParts = url.hostname.split('.');
    if (hostParts[1] === 's3' && hostParts[0]) {
      return { bucket: hostParts[0], key: decodeURIComponent(url.pathname.replace(/^\/+/, '')) };
    }
  } catch {}
  return { bucket: defaultBucket, key: trimmed };
}

function parseIncomingImagePayload(event, parsedJsonBody) {
  const rawContentType = (event?.headers?.['content-type'] || event?.headers?.['Content-Type'] || '')
    .split(';')[0]
    .trim()
    .toLowerCase();

  const body = event?.body;
  if (!body && !parsedJsonBody) {
    throw new Error('Nenhum arquivo de imagem foi enviado no corpo da requisição.');
  }

  if (parsedJsonBody) {
    const rawBase64 = String(
      parsedJsonBody.imageBase64 || parsedJsonBody.image || parsedJsonBody.data || '',
    ).trim();
    if (!rawBase64) throw new Error('O campo "imageBase64" é obrigatório.');

    let declaredMime = String(parsedJsonBody.contentType || '').toLowerCase().trim();
    let base64Clean = rawBase64;
    const dataUrlMatch = rawBase64.match(/^data:([^;]+);base64,(.+)$/i);
    if (dataUrlMatch) {
      declaredMime = dataUrlMatch[1].toLowerCase().trim();
      base64Clean = dataUrlMatch[2];
    }

    const buffer = Buffer.from(base64Clean, 'base64');
    const magicMime = detectImageMimeFromMagicBytes(buffer);
    const finalMime = magicMime || declaredMime;

    if (!magicMime || !ALLOWED_IMAGE_MIME_TYPES.has(finalMime)) {
      throw new Error('Arquivo inválido! Apenas arquivos de imagem (PNG, JPEG, WEBP ou GIF) são permitidos.');
    }

    return {
      buffer,
      contentType: finalMime === 'image/jpg' ? 'image/jpeg' : finalMime,
      fileName: String(parsedJsonBody.fileName || 'profile-avatar'),
    };
  }

  const buffer = event.isBase64Encoded
    ? Buffer.from(body, 'base64')
    : Buffer.isBuffer(body)
      ? body
      : Buffer.from(body, 'binary');

  const magicMime = detectImageMimeFromMagicBytes(buffer);
  const finalMime = magicMime || rawContentType;

  if (!magicMime || !ALLOWED_IMAGE_MIME_TYPES.has(finalMime)) {
    throw new Error('Arquivo inválido! Envie exclusivamente um arquivo de imagem válido (PNG, JPEG, WEBP ou GIF).');
  }

  return {
    buffer,
    contentType: finalMime === 'image/jpg' ? 'image/jpeg' : finalMime,
    fileName: event?.headers?.['x-file-name'] || event?.headers?.['X-File-Name'] || 'profile-avatar',
  };
}

export const handler = async (event) => {
  const method = (event?.requestContext?.http?.method || event?.httpMethod || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  let parsedJsonBody = null;
  if (method === 'POST' && event?.body) {
    if (typeof event.body === 'object' && !Buffer.isBuffer(event.body)) {
      parsedJsonBody = event.body;
    } else if (typeof event.body === 'string') {
      const rawStr = event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString('utf-8')
        : event.body;
      if (rawStr.trim().startsWith('{')) {
        try { parsedJsonBody = JSON.parse(rawStr); } catch { parsedJsonBody = null; }
      }
    }
  }

  const user = extractAuthenticatedUser(event, parsedJsonBody);
  if (!user) {
    return {
      statusCode: 401,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Não autorizado. Token JWT do Amazon Cognito ausente ou inválido.' }),
    };
  }

  const bucketName = await resolveProfileBucketName();
  const tableSchema = await resolveDynamoTableSchema();
  const dynamoKey = buildDynamoKey(tableSchema, user.username);

  try {
    // =========================================================================
    // POST /profile
    // - Sub-ação 1 (append_messages): Salva mensagens do chat com o agente de IA
    // - Sub-ação 2 (save_score): Registra pontuação de partida no DynamoDB e atualiza ranking
    // - Sub-ação 3 (save_team): Salva a equipe escolhida pelo usuário no DynamoDB
    // - Sub-ação 4 (padrão): Upload de imagem de perfil no S3 + link no DynamoDB
    // =========================================================================
    if (method === 'POST') {
      const updatedAt = new Date().toISOString();

      if (parsedJsonBody?.action === 'append_messages' && Array.isArray(parsedJsonBody.messages)) {
        const newDynamoMsgs = toDynamoMessagesList(parsedJsonBody.messages);

        const updateRes = await dynamo.send(
          new UpdateItemCommand({
            TableName: tableSchema.tableName,
            Key: dynamoKey,
            UpdateExpression:
              'SET messages = list_append(if_not_exists(messages, :empty_list), :new_msgs), updatedAt = :u, email = :e, userId = :uid',
            ExpressionAttributeValues: {
              ':empty_list': { L: [] },
              ':new_msgs': { L: newDynamoMsgs },
              ':u': { S: updatedAt },
              ':e': { S: user.email },
              ':uid': { S: user.userId },
            },
            ReturnValues: 'ALL_NEW',
          }),
        );

        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            message: 'Mensagens salvas no DynamoDB com sucesso!',
            username: user.username,
            tableName: tableSchema.tableName,
            messages: parseDynamoMessages(updateRes.Attributes?.messages),
          }),
        };
      }

      if (parsedJsonBody?.action === 'save_team') {
        const teamId = Number(parsedJsonBody.teamId || 0);
        const teamName = String(parsedJsonBody.teamName || 'Sem Equipe');

        await dynamo.send(
          new UpdateItemCommand({
            TableName: tableSchema.tableName,
            Key: dynamoKey,
            UpdateExpression:
              'SET teamId = :tid, teamName = :tname, updatedAt = :u, email = :e, userId = :uid, totalPoints = if_not_exists(totalPoints, :zero), scores = if_not_exists(scores, :empty_list), messages = if_not_exists(messages, :empty_list)',
            ExpressionAttributeValues: {
              ':tid': { N: String(teamId) },
              ':tname': { S: teamName },
              ':u': { S: updatedAt },
              ':e': { S: user.email },
              ':uid': { S: user.userId },
              ':zero': { N: '0' },
              ':empty_list': { L: [] },
            },
          }),
        );

        const rankings = await scanGlobalRankings(tableSchema);
        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            message: 'Equipe salva no DynamoDB com sucesso!',
            username: user.username,
            teamId,
            teamName,
            rankings,
          }),
        };
      }

      if (parsedJsonBody?.action === 'save_score' && parsedJsonBody.score) {
        const newScoreItem = toDynamoScoreMap(parsedJsonBody.score, user.userId);
        const addedPoints = Number(parsedJsonBody.score.totalPoints || 0);
        const teamId = parsedJsonBody.teamId ? Number(parsedJsonBody.teamId) : null;
        const teamName = parsedJsonBody.teamName ? String(parsedJsonBody.teamName) : null;

        let updateExpr =
          'SET scores = list_append(if_not_exists(scores, :empty_list), :new_score), totalPoints = if_not_exists(totalPoints, :zero) + :pts, updatedAt = :u, email = :e, userId = :uid, messages = if_not_exists(messages, :empty_list)';
        const exprValues = {
          ':empty_list': { L: [] },
          ':new_score': { L: [newScoreItem] },
          ':zero': { N: '0' },
          ':pts': { N: String(addedPoints) },
          ':u': { S: updatedAt },
          ':e': { S: user.email },
          ':uid': { S: user.userId },
        };

        if (teamId && teamName) {
          updateExpr += ', teamId = :tid, teamName = :tname';
          exprValues[':tid'] = { N: String(teamId) };
          exprValues[':tname'] = { S: teamName };
        }

        const updateRes = await dynamo.send(
          new UpdateItemCommand({
            TableName: tableSchema.tableName,
            Key: dynamoKey,
            UpdateExpression: updateExpr,
            ExpressionAttributeValues: exprValues,
            ReturnValues: 'ALL_NEW',
          }),
        );

        const rankings = await scanGlobalRankings(tableSchema);
        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            message: 'Pontuação salva no DynamoDB e ranking global atualizado!',
            username: user.username,
            totalPoints: Number(updateRes.Attributes?.totalPoints?.N || 0),
            scores: parseDynamoScores(updateRes.Attributes?.scores),
            rankings,
          }),
        };
      }

      // Upload de imagem de perfil exclusivamente
      const { buffer, contentType, fileName } = parseIncomingImagePayload(event, parsedJsonBody);
      const ext = MIME_TO_EXT[contentType] || 'png';
      const userSlug = sanitizeS3Slug(user.username);
      const objectKey = `profiles/${userSlug}/avatar.${ext}`;
      const s3Url = `https://${bucketName}.s3.${REGION}.amazonaws.com/${objectKey}`;

      await s3.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: objectKey,
          Body: buffer,
          ContentType: contentType,
          Metadata: {
            username: userSlug,
            userid: user.userId,
            email: user.email,
            filename: String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_'),
            updatedat: updatedAt,
          },
        }),
      );

      const dynamoUpdate = await dynamo.send(
        new UpdateItemCommand({
          TableName: tableSchema.tableName,
          Key: dynamoKey,
          UpdateExpression:
            'SET s3Url = :url, imageUrl = :url, s3Bucket = :b, s3Key = :k, contentType = :ct, updatedAt = :u, email = :e, userId = :uid, messages = if_not_exists(messages, :empty_list), scores = if_not_exists(scores, :empty_list), totalPoints = if_not_exists(totalPoints, :zero)',
          ExpressionAttributeValues: {
            ':url': { S: s3Url },
            ':b': { S: bucketName },
            ':k': { S: objectKey },
            ':ct': { S: contentType },
            ':u': { S: updatedAt },
            ':e': { S: user.email },
            ':uid': { S: user.userId },
            ':empty_list': { L: [] },
            ':zero': { N: '0' },
          },
          ReturnValues: 'ALL_NEW',
        }),
      );

      const rankings = await scanGlobalRankings(tableSchema);

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          message: 'Imagem de perfil salva no S3 e vinculada ao seu usuário no DynamoDB!',
          username: user.username,
          tableName: tableSchema.tableName,
          partitionKey: tableSchema.hashKeyName,
          s3Url,
          bucket: bucketName,
          key: objectKey,
          contentType,
          sizeBytes: buffer.length,
          updatedAt,
          imageUrl: `data:${contentType};base64,${buffer.toString('base64')}`,
          messages: parseDynamoMessages(dynamoUpdate.Attributes?.messages),
          scores: parseDynamoScores(dynamoUpdate.Attributes?.scores),
          rankings,
        }),
      };
    }

    // =========================================================================
    // GET /profile
    // - Garante que o usuário logado já esteja registrado na tabela do DynamoDB
    //   (para aparecer imediatamente no Ranking Global mesmo em um novo PC)
    // - Retorna imagem do S3, lista de mensagens com a IA, histórico de scores,
    //   equipe e a lista completa do Ranking Global (todos os usuários do DynamoDB)
    // =========================================================================
    if (method === 'GET') {
      const ensureUserRes = await dynamo.send(
        new UpdateItemCommand({
          TableName: tableSchema.tableName,
          Key: dynamoKey,
          UpdateExpression:
            'SET email = :e, userId = :uid, messages = if_not_exists(messages, :empty_list), scores = if_not_exists(scores, :empty_list), totalPoints = if_not_exists(totalPoints, :zero)',
          ExpressionAttributeValues: {
            ':e': { S: user.email },
            ':uid': { S: user.userId },
            ':empty_list': { L: [] },
            ':zero': { N: '0' },
          },
          ReturnValues: 'ALL_NEW',
        }),
      );

      const item = ensureUserRes.Attributes || {};
      const messages = parseDynamoMessages(item.messages);
      const scores = parseDynamoScores(item.scores);
      const totalPoints = Number(item.totalPoints?.N || 0);
      const teamId = item.teamId?.N ? Number(item.teamId.N) : null;
      const teamName = item.teamName?.S || null;
      const s3Url = item.s3Url?.S || item.imageUrl?.S || null;

      const rankings = await scanGlobalRankings(tableSchema);

      let targetBucket = item.s3Bucket?.S || bucketName;
      let targetKey = item.s3Key?.S || null;

      if (!targetKey && s3Url) {
        const parsedLoc = parseS3Url(s3Url, bucketName);
        if (parsedLoc) {
          targetBucket = parsedLoc.bucket;
          targetKey = parsedLoc.key;
        }
      }

      if (!targetKey) {
        targetKey = `profiles/${sanitizeS3Slug(user.username)}/avatar.png`;
      }

      try {
        let s3Response;
        try {
          s3Response = await s3.send(new GetObjectCommand({ Bucket: targetBucket, Key: targetKey }));
        } catch {
          const legacyKey = `profiles/${user.userId}/avatar`;
          s3Response = await s3.send(new GetObjectCommand({ Bucket: bucketName, Key: legacyKey }));
          targetBucket = bucketName;
          targetKey = legacyKey;
        }

        const byteArray = await s3Response.Body.transformToByteArray();
        const buffer = Buffer.from(byteArray);
        const contentType =
          item.contentType?.S ||
          s3Response.ContentType ||
          detectImageMimeFromMagicBytes(buffer) ||
          'image/jpeg';
        const base64String = buffer.toString('base64');
        const resolvedS3Url =
          s3Url || `https://${targetBucket}.s3.${REGION}.amazonaws.com/${targetKey}`;

        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            exists: true,
            username: user.username,
            tableName: tableSchema.tableName,
            partitionKey: tableSchema.hashKeyName,
            s3Url: resolvedS3Url,
            bucket: targetBucket,
            key: targetKey,
            contentType,
            sizeBytes: buffer.length,
            updatedAt: item.updatedAt?.S || s3Response.LastModified?.toISOString() || null,
            imageUrl: `data:${contentType};base64,${base64String}`,
            messages,
            scores,
            totalPoints,
            teamId,
            teamName,
            rankings,
          }),
        };
      } catch (s3Err) {
        if (s3Err?.name === 'NoSuchKey' || s3Err?.$metadata?.httpStatusCode === 404) {
          return {
            statusCode: 200,
            headers: CORS_HEADERS,
            body: JSON.stringify({
              exists: false,
              username: user.username,
              tableName: tableSchema.tableName,
              partitionKey: tableSchema.hashKeyName,
              s3Url: null,
              imageUrl: null,
              messages,
              scores,
              totalPoints,
              teamId,
              teamName,
              rankings,
            }),
          };
        }
        throw s3Err;
      }
    }

    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: `Método ${method} não permitido.` }),
    };
  } catch (error) {
    console.error('[RANDANDAN Profile Lambda] Erro:', error);
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Erro interno no S3/DynamoDB.',
      }),
    };
  }
};
