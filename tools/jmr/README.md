# JMR extraction

DISCOM joint meter readings arrive as one scanned PDF per site per month. Nothing in
them is text, so they are OCR'd with the macOS Vision framework (no install needed).

    swiftc -O -o ocr ocr.swift
    ./ocr "<site> august 26 jmr.pdf" out.txt     # renders page 1, tries 4 rotations, keeps best

Parsing rule that survived August 2026 (47/48 automatic):

- Candidate = any plain number 40,000–1,200,000 not glued to letters (meter serials are alpha-prefixed).
- Drop candidates with a neighbour within ±10: those are sequential stamped form numbers.
- The main and check meters agree within 1.5%; take the highest such pair, use the smaller value.
- The export figure is the DISCOM's "Import" row (energy received from the plant). On AVVNL
  forms it is labelled Export (reverse). Multiply the difference by MF if reading the page by eye.
- Review anything whose DGR/JMR ratio is outside 0.97–1.05. Layouts differ by DISCOM
  (AVVNL / JdVVNL / JVVNL / DVVNL) and the Gajroopdesar files are named opposite to the
  DGR: the file called "-1" is the 2.52 MW plant.

Loaded values go to `jmr_readings` (migration 010).
