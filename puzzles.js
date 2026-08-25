/*
 * puzzles.js — GENERATED FILE, DO NOT EDIT BY HAND.
 *
 * Regenerate with:  node build-puzzles.js --count 30 --seed 20260101
 *
 * Pure data, no logic. Every puzzle comes from the Lichess open puzzle
 * database (CC0), engine-verified upstream and re-verified here: the FEN is
 * loaded, the solution played, and the final position asserted to be checkmate
 * in exactly `mateIn` player moves.
 *
 *   id        Lichess PuzzleId — https://lichess.org/training/<id>
 *   fen       position the player sees, AFTER the database's first move
 *   solution  remaining moves in SAN, player and opponent alternating,
 *             starting and ending with the player
 *   mateIn    number of player moves to mate
 *   rating    Lichess difficulty rating; kept for reference, never shown
 *
 * Generated 2026-08-22 from lichess_db_puzzle.csv
 */

export const PUZZLES = [
  {
    id: "juLnn",
    fen: "7Q/k7/p1pN4/KpPp4/3P4/3q2p1/PP6/8 b - - 1 52",
    solution: ["Qd2+","b4","Qxa2#"],
    mateIn: 2,
    rating: 1273,
  },
  {
    id: "LqTk2",
    fen: "8/1P2QBbk/6pp/2P2p2/5q2/8/3r3P/6RK w - - 5 40",
    solution: ["Bxg6+","Kh8","Qe8+","Bf8","Qxf8#"],
    mateIn: 3,
    rating: 1081,
  },
  {
    id: "JrPOE",
    fen: "8/4R3/3r1p1k/4PP2/6pp/7P/6PK/8 b - - 0 49",
    solution: ["g3+","Kg1","Rd1#"],
    mateIn: 2,
    rating: 1102,
  },
  {
    id: "mvYsy",
    fen: "4r1k1/3Q1pp1/2N4p/8/7q/4b2P/P5PK/1R6 b - - 1 30",
    solution: ["Bf4+","Kg1","Re1+","Rxe1","Qxe1#"],
    mateIn: 3,
    rating: 1364,
  },
  {
    id: "Rk7x0",
    fen: "3Q4/1q5k/3PR2p/1p4p1/8/P5K1/1P3P1P/3r4 b - - 3 41",
    solution: ["Rg1+","Kh3","Qf3#"],
    mateIn: 2,
    rating: 1298,
  },
  {
    id: "prDsb",
    fen: "8/7P/8/3p4/3P4/1p6/3k4/K7 b - - 0 62",
    solution: ["Kc2","h8=Q","b2+","Ka2","b1=Q+","Ka3","Qb3#"],
    mateIn: 4,
    rating: 1278,
  },
  {
    id: "1QMsL",
    fen: "2r5/1R4pp/8/8/R7/4k1P1/7r/4K3 w - - 0 42",
    solution: ["Rb3+","Rc3","Rxc3#"],
    mateIn: 2,
    rating: 1498,
  },
  {
    id: "LZAPf",
    fen: "8/8/p7/2pN2pp/2P3k1/r7/6K1/5R2 w - - 4 58",
    solution: ["Nf6+","Kh4","Rh1+","Rh3","Rxh3#"],
    mateIn: 3,
    rating: 1311,
  },
  {
    id: "Bj7LQ",
    fen: "3QQ3/kp3q2/p7/3p4/2pP2P1/P1Pn2K1/8/8 b - - 0 50",
    solution: ["Qf2+","Kh3","Nf4#"],
    mateIn: 2,
    rating: 1424,
  },
  {
    id: "gFHj7",
    fen: "6Q1/2R5/8/p7/8/kPn3r1/P7/K7 b - - 0 43",
    solution: ["Rxg8","Rxc3","Rg1+","Rc1","Rxc1#"],
    mateIn: 3,
    rating: 1175,
  },
  {
    id: "iU6yL",
    fen: "5rk1/1q3Npp/8/3pP3/4r3/5Q2/1P4PP/5R1K w - - 1 33",
    solution: ["Nh6+","gxh6","Qxf8#"],
    mateIn: 2,
    rating: 1148,
  },
  {
    id: "rRRF7",
    fen: "3QR3/rk5p/1qp5/8/3p2pP/2p3P1/5P2/6K1 w - - 4 44",
    solution: ["Qc8#"],
    mateIn: 1,
    rating: 1585,
  },
  {
    id: "OFHph",
    fen: "3r4/P4R2/1k6/2p4K/5P2/8/6r1/R7 b - - 0 54",
    solution: ["Rh8+","Rh7","Rxh7#"],
    mateIn: 2,
    rating: 1381,
  },
  {
    id: "ZFZJa",
    fen: "6k1/R5p1/8/8/3P4/5RB1/PP1rr2P/7K b - - 0 33",
    solution: ["Rd1+","Be1","Rdxe1+","Rf1","Rxf1#"],
    mateIn: 3,
    rating: 1099,
  },
  {
    id: "eAhZi",
    fen: "1k6/p2Q4/1p6/5p2/8/4b1P1/PB1p2KP/3q4 w - - 8 50",
    solution: ["Be5+","Ka8","Qc8#"],
    mateIn: 2,
    rating: 1245,
  },
  {
    id: "BmmvR",
    fen: "1R3bk1/5p1p/5Pp1/8/3q4/1p3BKP/1P1rQ3/8 w - - 10 50",
    solution: ["Rxf8+","Kxf8","Qe7+","Kg8","Qe8#"],
    mateIn: 3,
    rating: 1371,
  },
  {
    id: "Fhnrr",
    fen: "kr6/1p6/pP1Q2p1/4p3/4q2p/7P/6PK/3R4 w - - 0 32",
    solution: ["Qxb8+","Kxb8","Rd8#"],
    mateIn: 2,
    rating: 1169,
  },
  {
    id: "Q5mt0",
    fen: "8/5r2/rp2p3/p2p4/1k1n3R/2R5/PKP5/8 w - - 0 31",
    solution: ["Rxd4+","Kb5","a4#"],
    mateIn: 2,
    rating: 1502,
  },
  {
    id: "2C8kc",
    fen: "8/pp6/3P4/2P2Nk1/7p/1Qq3b1/P5B1/6K1 b - - 1 44",
    solution: ["Qe1+","Bf1","Qf2+","Kh1","Qxf1#"],
    mateIn: 3,
    rating: 1224,
  },
  {
    id: "VJmgI",
    fen: "8/8/PN6/8/5p2/5kp1/3P4/5K2 b - - 0 50",
    solution: ["g2+","Kg1","Kg3","d3","f3","d4","f2#"],
    mateIn: 4,
    rating: 1230,
  },
  {
    id: "5ysr3",
    fen: "2r5/2r5/3p4/p2P2p1/1pPKR2p/6kP/P1R5/8 w - - 3 47",
    solution: ["Re3+","Kf4","Rf2#"],
    mateIn: 2,
    rating: 1477,
  },
  {
    id: "9xti2",
    fen: "3k4/7Q/2qb4/7p/P2P2pP/2P3P1/5p1K/1R6 b - - 0 45",
    solution: ["Bxg3+","Kxg3","Qf3+","Kh2","Qh3#"],
    mateIn: 3,
    rating: 1563,
  },
  {
    id: "4nHo5",
    fen: "8/2R4p/6pk/8/2n3PP/5Kn1/4p3/8 w - - 0 57",
    solution: ["g5+","Kh5","Rxh7#"],
    mateIn: 2,
    rating: 1327,
  },
  {
    id: "45x2A",
    fen: "8/8/5p2/2p1p3/4R3/R4P1K/5kB1/3q2q1 w - - 0 57",
    solution: ["Ra2+","Qe2","Raxe2#"],
    mateIn: 2,
    rating: 1051,
  },
  {
    id: "j888H",
    fen: "5k2/pp5Q/7p/6p1/3n4/1P3qPP/P4P2/1B4K1 b - - 6 37",
    solution: ["Ne2+","Kf1","Nxg3+","Ke1","Qe2#"],
    mateIn: 3,
    rating: 1324,
  },
  {
    id: "cM6IX",
    fen: "r2R1rk1/4Pppp/8/8/1pP5/5P2/1P3K1P/8 w - - 2 30",
    solution: ["exf8=Q#"],
    mateIn: 1,
    rating: 1331,
  },
  {
    id: "LPaqf",
    fen: "4B2k/1p4pp/5q2/8/Q2n2b1/6P1/1B5P/2R3K1 b - - 0 32",
    solution: ["Ne2+","Kg2","Qf3#"],
    mateIn: 2,
    rating: 1552,
  },
  {
    id: "e8cXD",
    fen: "6k1/5pp1/5b2/8/7q/1Qp5/P5B1/2R1R1K1 b - - 0 38",
    solution: ["Bd4+","Re3","Bxe3+","Kf1","Qf2#"],
    mateIn: 3,
    rating: 1392,
  },
  {
    id: "7jHym",
    fen: "k7/P3n1p1/1PP5/1K6/8/7p/8/8 w - - 1 55",
    solution: ["Ka6","h2","b7#"],
    mateIn: 2,
    rating: 1553,
  },
  {
    id: "AKNTo",
    fen: "3kr3/5Q2/2q2P2/p2n3p/8/BP6/P5PP/2R4K b - - 2 32",
    solution: ["Qxc1+","Bxc1","Re1#"],
    mateIn: 2,
    rating: 1108,
  },
];
