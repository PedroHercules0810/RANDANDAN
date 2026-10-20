import { GoogleGenAI } from '@google/genai';

/**
 * Catálogo oficial de motocicletas do RANDANDAN.
 * A função Lambda NÃO sabe e NÃO calcula qual é a moto secreta do dia/rodada;
 * ela apenas conhece o catálogo geral e analisa as pistas já obtidas pelo jogador.
 */
const MOTORCYCLES_CATALOG = [
  // Honda
  { manufacturer: 'Honda', model: 'CBR 1000RR-R Fireblade', displacementCc: 1000, weightKg: 201, style: 'Sport', fipePrice: 'R$ 189.900', topSpeedKmh: 299 },
  { manufacturer: 'Honda', model: 'CBR 650R', displacementCc: 649, weightKg: 208, style: 'Sport', fipePrice: 'R$ 56.900', topSpeedKmh: 225 },
  { manufacturer: 'Honda', model: 'CB 650R', displacementCc: 649, weightKg: 202, style: 'Naked', fipePrice: 'R$ 53.800', topSpeedKmh: 220 },
  { manufacturer: 'Honda', model: 'CB 500F', displacementCc: 471, weightKg: 189, style: 'Naked', fipePrice: 'R$ 41.500', topSpeedKmh: 185 },
  { manufacturer: 'Honda', model: 'CB 500X', displacementCc: 471, weightKg: 199, style: 'Trail', fipePrice: 'R$ 44.600', topSpeedKmh: 182 },
  { manufacturer: 'Honda', model: 'CB 300F Twister', displacementCc: 293, weightKg: 139, style: 'Street', fipePrice: 'R$ 24.490', topSpeedKmh: 155 },
  { manufacturer: 'Honda', model: 'CG 160 Titan', displacementCc: 162, weightKg: 117, style: 'Street', fipePrice: 'R$ 18.890', topSpeedKmh: 128 },
  { manufacturer: 'Honda', model: 'XRE 300 Sahara', displacementCc: 293, weightKg: 147, style: 'Trail', fipePrice: 'R$ 29.590', topSpeedKmh: 148 },
  { manufacturer: 'Honda', model: 'CRF 1100L Africa Twin', displacementCc: 1084, weightKg: 226, style: 'Trail', fipePrice: 'R$ 92.900', topSpeedKmh: 210 },
  // Yamaha
  { manufacturer: 'Yamaha', model: 'YZF-R1', displacementCc: 998, weightKg: 201, style: 'Sport', fipePrice: 'R$ 138.900', topSpeedKmh: 299 },
  { manufacturer: 'Yamaha', model: 'YZF-R3', displacementCc: 321, weightKg: 171, style: 'Sport', fipePrice: 'R$ 34.890', topSpeedKmh: 188 },
  { manufacturer: 'Yamaha', model: 'YZF-R15', displacementCc: 155, weightKg: 141, style: 'Sport', fipePrice: 'R$ 21.790', topSpeedKmh: 145 },
  { manufacturer: 'Yamaha', model: 'MT-09', displacementCc: 890, weightKg: 189, style: 'Naked', fipePrice: 'R$ 61.990', topSpeedKmh: 235 },
  { manufacturer: 'Yamaha', model: 'MT-07', displacementCc: 689, weightKg: 184, style: 'Naked', fipePrice: 'R$ 48.990', topSpeedKmh: 214 },
  { manufacturer: 'Yamaha', model: 'MT-03', displacementCc: 321, weightKg: 169, style: 'Naked', fipePrice: 'R$ 32.690', topSpeedKmh: 180 },
  { manufacturer: 'Yamaha', model: 'Fazer FZ25', displacementCc: 249, weightKg: 149, style: 'Street', fipePrice: 'R$ 23.490', topSpeedKmh: 142 },
  { manufacturer: 'Yamaha', model: 'Lander 250', displacementCc: 249, weightKg: 153, style: 'Trail', fipePrice: 'R$ 26.890', topSpeedKmh: 138 },
  { manufacturer: 'Yamaha', model: 'Tracer 900 GT', displacementCc: 847, weightKg: 215, style: 'Touring', fipePrice: 'R$ 69.490', topSpeedKmh: 225 },
  // Kawasaki
  { manufacturer: 'Kawasaki', model: 'Ninja ZX-10R', displacementCc: 998, weightKg: 207, style: 'Sport', fipePrice: 'R$ 119.990', topSpeedKmh: 299 },
  { manufacturer: 'Kawasaki', model: 'Ninja ZX-6R', displacementCc: 636, weightKg: 198, style: 'Sport', fipePrice: 'R$ 77.990', topSpeedKmh: 260 },
  { manufacturer: 'Kawasaki', model: 'Ninja 650', displacementCc: 649, weightKg: 193, style: 'Sport', fipePrice: 'R$ 49.990', topSpeedKmh: 212 },
  { manufacturer: 'Kawasaki', model: 'Ninja 400', displacementCc: 399, weightKg: 168, style: 'Sport', fipePrice: 'R$ 36.490', topSpeedKmh: 195 },
  { manufacturer: 'Kawasaki', model: 'Z900', displacementCc: 948, weightKg: 212, style: 'Naked', fipePrice: 'R$ 63.990', topSpeedKmh: 245 },
  { manufacturer: 'Kawasaki', model: 'Z650', displacementCc: 649, weightKg: 188, style: 'Naked', fipePrice: 'R$ 47.490', topSpeedKmh: 210 },
  { manufacturer: 'Kawasaki', model: 'Z400', displacementCc: 399, weightKg: 167, style: 'Naked', fipePrice: 'R$ 34.490', topSpeedKmh: 188 },
  { manufacturer: 'Kawasaki', model: 'Versys 650', displacementCc: 649, weightKg: 219, style: 'Touring', fipePrice: 'R$ 55.990', topSpeedKmh: 200 },
  // Suzuki
  { manufacturer: 'Suzuki', model: 'Hayabusa 1300', displacementCc: 1340, weightKg: 264, style: 'Sport', fipePrice: 'R$ 124.500', topSpeedKmh: 299 },
  { manufacturer: 'Suzuki', model: 'GSX-S1000', displacementCc: 999, weightKg: 214, style: 'Naked', fipePrice: 'R$ 79.900', topSpeedKmh: 250 },
  { manufacturer: 'Suzuki', model: 'GSX-S750', displacementCc: 749, weightKg: 213, style: 'Naked', fipePrice: 'R$ 54.900', topSpeedKmh: 230 },
  { manufacturer: 'Suzuki', model: 'V-Strom 650 XT', displacementCc: 645, weightKg: 216, style: 'Trail', fipePrice: 'R$ 56.900', topSpeedKmh: 195 },
  // BMW
  { manufacturer: 'BMW', model: 'S 1000 RR', displacementCc: 999, weightKg: 197, style: 'Sport', fipePrice: 'R$ 129.900', topSpeedKmh: 303 },
  { manufacturer: 'BMW', model: 'R 1250 GS', displacementCc: 1254, weightKg: 249, style: 'Trail', fipePrice: 'R$ 112.900', topSpeedKmh: 219 },
  { manufacturer: 'BMW', model: 'F 850 GS', displacementCc: 853, weightKg: 229, style: 'Trail', fipePrice: 'R$ 74.500', topSpeedKmh: 204 },
  { manufacturer: 'BMW', model: 'G 310 R', displacementCc: 313, weightKg: 164, style: 'Naked', fipePrice: 'R$ 34.900', topSpeedKmh: 143 },
  // Ducati, Triumph & KTM
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

/**
 * Filtra quais motos do catálogo ainda são compatíveis com as tentativas
 * e dicas enviadas pelo jogador (sem nunca receber a moto secreta).
 *
 * Semântica das setas do RANDANDAN:
 * - higher (▲ MAIOR QUE O SECRETO): o valor chutado é MAIOR que o da moto secreta -> secreto < chute
 * - lower  (▼ MENOR QUE O SECRETO): o valor chutado é MENOR que o da moto secreta -> secreto > chute
 */
function filterCandidateMotorcycles(guesses = [], hints = {}) {
  return MOTORCYCLES_CATALOG.filter((candidate) => {
    for (const g of guesses) {
      if (!g || !g.motorcycle) continue;
      const guessed = g.motorcycle;

      // Não pode ser uma moto que já foi chutada e errou o modelo
      if (g.modelStatus === 'wrong' && candidate.model === guessed.model) {
        return false;
      }

      // Marca
      if (g.manufacturerStatus === 'correct' && candidate.manufacturer !== guessed.manufacturer) {
        return false;
      }
      if (g.manufacturerStatus === 'wrong' && candidate.manufacturer === guessed.manufacturer) {
        return false;
      }

      // Estilo
      if (g.styleStatus === 'correct' && candidate.style !== guessed.style) {
        return false;
      }
      if (g.styleStatus === 'wrong' && candidate.style === guessed.style) {
        return false;
      }

      // Cilindrada (cc)
      if (g.displacementStatus === 'correct' && candidate.displacementCc !== guessed.displacementCc) {
        return false;
      }
      if (g.displacementStatus === 'higher' && !(candidate.displacementCc < guessed.displacementCc)) {
        return false;
      }
      if (g.displacementStatus === 'lower' && !(candidate.displacementCc > guessed.displacementCc)) {
        return false;
      }

      // Peso (kg)
      if (g.weightStatus === 'correct' && candidate.weightKg !== guessed.weightKg) {
        return false;
      }
      if (g.weightStatus === 'higher' && !(candidate.weightKg < guessed.weightKg)) {
        return false;
      }
      if (g.weightStatus === 'lower' && !(candidate.weightKg > guessed.weightKg)) {
        return false;
      }
    }

    if (hints?.fipePrice && candidate.fipePrice !== hints.fipePrice) {
      return false;
    }
    if (hints?.topSpeedKmh && candidate.topSpeedKmh !== Number(hints.topSpeedKmh)) {
      return false;
    }

    return true;
  });
}

const SYSTEM_INSTRUCTION = `
Você é o "Chefe de Box RANDANDAN", o mecânico e engenheiro de pista especialista em motocicletas do jogo RANDANDAN.
Sua missão é ajudar o jogador a deduzir a moto secreta dando dicas inteligentes, analisando os chutes anteriores e tirando dúvidas sobre fichas técnicas.

REGRAS CRÍTICAS:
1. Você NÃO SABE qual é a moto secreta do dia ou da rodada. Nunca finja que sabe a resposta exata de antemão.
2. Lembre-se da regra das setas do RANDANDAN nas colunas de Cilindrada (cc) e Peso (kg):
   - "higher" (▲ MAIOR QUE O SECRETO): significa que o valor da moto CHUTADA é MAIOR do que o da moto secreta (logo, a moto secreta tem valor MENOR que o chute).
   - "lower" (▼ MENOR QUE O SECRETO): significa que o valor da moto CHUTADA é MENOR do que o da moto secreta (logo, a moto secreta tem valor MAIOR que o chute).
3. Use a lista de "Motos candidatas restantes no catálogo" fornecida no contexto para orientar o jogador.
4. Ao dar dicas, não entregue apenas uma lista seca: ajude o jogador a raciocinar (ex: quais marcas ou faixas de cilindrada/peso ainda restam, ou qual seria um excelente próximo chute para eliminar metade das opções).
5. Se o jogador pedir explicitamente quais motos ainda cabem nas pistas, você pode citar alguns modelos compatíveis do catálogo.
6. Responda sempre em português brasileiro (pt-BR), de forma concisa (máximo de 2 a 4 parágrafos curtos), animada e com vocabulário motociclístico.
`.trim();

export const handler = async (event) => {
  const method =
    event?.requestContext?.http?.method ||
    event?.httpMethod ||
    'POST';

  // Resposta de preflight CORS
  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: CORS_HEADERS,
      body: '',
    };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: 'A variável de ambiente GEMINI_API_KEY não está configurada na função Lambda.',
      }),
    };
  }

  try {
    const rawBody = typeof event?.body === 'string' ? JSON.parse(event.body || '{}') : (event?.body || event || {});
    const userMessage = (rawBody.message || '').trim();
    const guesses = Array.isArray(rawBody.guesses) ? rawBody.guesses : [];
    const hints = rawBody.hints || {};
    const history = Array.isArray(rawBody.history) ? rawBody.history : [];

    if (!userMessage) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: 'O campo "message" é obrigatório.',
        }),
      };
    }

    const candidates = filterCandidateMotorcycles(guesses, hints);

    const gameContextText = [
      `ESTADO ATUAL DA PARTIDA DO JOGADOR (tentativas feitas: ${guesses.length}/6):`,
      guesses.length > 0
        ? guesses
            .map(
              (g, idx) =>
                `Tentativa #${idx + 1}: ${g.motorcycle?.manufacturer} ${g.motorcycle?.model} (${g.motorcycle?.style}, ${g.motorcycle?.displacementCc}cc, ${g.motorcycle?.weightKg}kg) -> ` +
                `Marca: ${g.manufacturerStatus}, Estilo: ${g.styleStatus}, Cilindrada: ${g.displacementStatus}, Peso: ${g.weightStatus}`
            )
            .join('\n')
        : 'Nenhuma tentativa realizada ainda.',
      hints?.fipePrice ? `Dica FIPE revelada: ${hints.fipePrice}` : '',
      hints?.topSpeedKmh ? `Dica Top Speed revelada: ${hints.topSpeedKmh} km/h` : '',
      `\nMOTOS DO CATÁLOGO QUE AINDA COMBINAM COM AS PISTAS (${candidates.length} de ${MOTORCYCLES_CATALOG.length}):`,
      candidates
        .map(
          (m) =>
            `- ${m.manufacturer} ${m.model} | Estilo: ${m.style} | ${m.displacementCc} cc | ${m.weightKg} kg | FIPE: ${m.fipePrice} | Top Speed: ${m.topSpeedKmh} km/h`
        )
        .join('\n'),
    ]
      .filter(Boolean)
      .join('\n');

    const ai = new GoogleGenAI({ apiKey });

    // Monta o histórico de conversa + mensagem atual
    const contents = [
      ...history
        .filter((item) => item && item.text && (item.role === 'user' || item.role === 'model'))
        .map((item) => ({
          role: item.role,
          parts: [{ text: String(item.text) }],
        })),
      {
        role: 'user',
        parts: [
          {
            text: `${gameContextText}\n\nPERGUNTA DO JOGADOR: ${userMessage}`,
          },
        ],
      },
    ];

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.5,
        maxOutputTokens: 600,
      },
    });

    const reply =
      response?.text?.trim() ||
      'Opa, piloto! Tive uma falha na telemetria aqui no box. Tente mandar sua pergunta novamente!';

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        reply,
        candidatesRemaining: candidates.length,
        // Sinaliza ao frontend que o uso do chat de IA zera a pontuação da partida
        zeroScore: true,
        scoreMultiplier: 0,
      }),
    };
  } catch (error) {
    console.error('[randandan-gemini-chat-lambda] Erro ao consultar o Gemini:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: 'Erro ao consultar o assistente Gemini.',
        details: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};
