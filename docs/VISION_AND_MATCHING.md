# Vision and exact card matching

A general image model can describe a card, but the definitive product needs a specialized retrieval system.

## Recommended pipeline

1. **Quality gate** — detect blur, glare, cutoff edges, sleeve reflections, and back/front orientation.
2. **Card crop** — find the card corners and rectify perspective.
3. **OCR** — extract player name, copyright year, card number, set text, serial numbering, grader, grade, and cert number.
4. **Visual retrieval** — compare an image embedding against a licensed card-image catalog.
5. **Metadata reranking** — combine OCR tokens, sport, year, brand, set, number, parallel, and grading details.
6. **Front/back merge** — use the back image to resolve visually similar parallels.
7. **Slab verification** — validate certification through grader-approved integrations where available.
8. **Human confirmation** — show the top candidates, differences, and confidence.

## Training/evaluation set

Build a rights-cleared dataset with:

- Every major sport and TCG
- Base, parallels, inserts, variations, autographs, memorabilia, and serial-numbered cards
- Raw cards and major grading holders
- Sleeves, top loaders, team bags, one-touch holders, and display cases
- Bright show lighting, dim rooms, glare, tilted angles, hands, and cluttered backgrounds
- Front and back pairs
- Known hard negatives: same photo with different foil/color/numbering

## Success thresholds

- Top-1 exact identity: at least 95% on common cards
- Top-3 exact identity: at least 99%
- Low-confidence cases routed to confirmation rather than silently guessed
- Median scan-to-result latency below two seconds on a warm cache
- Correction rate tracked by set, year, sport, device, and lighting condition

## Included adapter

The server can send an explicitly submitted image to a configured OpenAI vision-capable model, obtain structured card attributes, and match those attributes against the local catalog. This is useful for prototyping, OCR assistance, and candidate generation. It is not a substitute for the specialized retrieval/evaluation pipeline above.
