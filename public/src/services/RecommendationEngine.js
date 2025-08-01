// src/services/RecommendationEngine.js

import { NoteClassifier } from '../data/NoteClassification.js';
import { NoteNormalizer } from '../utils/NoteNormalizer.js';


class RecommendationEngine {
  
  // Find perfumes similar to a target perfume
  static findSimilarPerfumes(targetPerfume, candidatePerfumes, maxResults = 10) {
    const recommendations = candidatePerfumes.map(candidate => {
      const similarity = this.calculateSimilarityScore(targetPerfume, candidate);
      return {
        perfume: candidate,
        similarityScore: similarity.score,
        sharedNotes: similarity.sharedNotes,
        reasoning: similarity.reasoning
      };
    });
    
    // Sort by similarity score (highest first)
    return recommendations
      .sort((a, b) => b.similarityScore - a.similarityScore)
      .slice(0, maxResults);
  }
  
  // Calculate how similar two perfumes are (0-1 scale)
  static calculateSimilarityScore(perfume1, perfume2) {
    let score = 0;
    let maxPossibleScore = 0;
    const reasoning = [];
    const sharedNotes = [];
    
    // Get all normalized notes from both perfumes
    const notes1 = this.getAllNotes(perfume1);
    const notes2 = this.getAllNotes(perfume2);
    
    // 1. SHARED NOTES SCORING (main factor)
    const noteMatches = notes1.filter(note1 => 
      notes2.some(note2 => note1.toLowerCase() === note2.toLowerCase())
    );
    
    sharedNotes.push(...noteMatches);
    score += noteMatches.length;
    maxPossibleScore += Math.max(notes1.length, notes2.length);
    
    if (noteMatches.length > 0) {
      reasoning.push(`${noteMatches.length} shared notes: ${noteMatches.join(', ')}`);
    }
    
    // 2. FRAGRANCE FAMILY BONUS
    if (perfume1.fragranceFamily === perfume2.fragranceFamily) {
      score += 0.5;
      reasoning.push(`Same fragrance family: ${perfume1.fragranceFamily}`);
    }
    maxPossibleScore += 0.5;
    
    // 3. BASE NOTES BONUS (they're more important for longevity)
    const normalizedBase1 = NoteNormalizer.normalizeArray(perfume1.notes.base || []);
    const normalizedBase2 = NoteNormalizer.normalizeArray(perfume2.notes.base || []);
    
    const baseMatches = normalizedBase1.filter(note1 =>
      normalizedBase2.some(note2 => note1.toLowerCase() === note2.toLowerCase())
    );
    
    if (baseMatches.length > 0) {
      score += 0.2 * baseMatches.length;
      reasoning.push(`Shared base notes: ${baseMatches.join(', ')}`);
    }
    maxPossibleScore += 0.2 * Math.max(normalizedBase1.length, normalizedBase2.length);
    
    // 4. SUBCATEGORY RELATIONSHIP BONUS (using our classification system!)
    const subcategoryBonus = this.calculateSubcategoryBonus(perfume1, perfume2);
    score += subcategoryBonus.score;
    maxPossibleScore += 0.3;
    
    if (subcategoryBonus.reasoning) {
      reasoning.push(subcategoryBonus.reasoning);
    }
    
    // Normalize to 0-1 scale
    const normalizedScore = maxPossibleScore > 0 ? score / maxPossibleScore : 0;
    
    return {
      score: Math.round(normalizedScore * 100) / 100, // Round to 2 decimals
      sharedNotes: sharedNotes,
      reasoning: reasoning
    };
  }
  
  // Helper: Get all normalized notes from a perfume
  static getAllNotes(perfume) {
    const allNotes = [
      ...(perfume.notes.top || []),
      ...(perfume.notes.middle || []),
      ...(perfume.notes.base || [])
    ];
    
    // Normalize all notes for consistent comparison
    return NoteNormalizer.normalizeArray(allNotes);
  }
  
  // Helper: Calculate bonus for related subcategories
  static calculateSubcategoryBonus(perfume1, perfume2) {
    const notes1 = this.getAllNotes(perfume1);
    const notes2 = this.getAllNotes(perfume2);
    
    // Find dominant subcategories for each perfume
    const subcategories1 = this.getDominantSubcategoriesWithNames(notes1);
    const subcategories2 = this.getDominantSubcategoriesWithNames(notes2);
    
    // Check for complementary relationships
    let bonus = 0;
    let reasoning = '';
    
    for (const subcat1 of subcategories1) {
      for (const subcat2 of subcategories2) {
        if (subcat1.key === subcat2.key) {
          bonus = 0.3; // Same subcategory
          reasoning = `Both have ${subcat1.name} characteristics`;
          break;
        }
        
        // Check if they're complementary
        const complements = NoteClassifier.getComplementarySubcategories(subcat1.key);
        if (complements.includes(subcat2.key)) {
          bonus = 0.2; // Complementary subcategories
          reasoning = `${subcat1.name} complements ${subcat2.name}`;
          break;
        }
      }
      if (bonus > 0) break;
    }
    
    return { score: bonus, reasoning: reasoning };
  }
  
  // Helper: Find dominant subcategories in a set of notes (returns keys only for internal use)
  static getDominantSubcategories(notes) {
    const subcategoryCounts = {};
    
    // Ensure notes are normalized before classification
    const normalizedNotes = NoteNormalizer.normalizeArray(notes);
    
    normalizedNotes.forEach(note => {
      const classification = NoteClassifier.classifyNote(note);
      if (classification.subcategoryKey !== 'COMPLEX') {
        subcategoryCounts[classification.subcategoryKey] = 
          (subcategoryCounts[classification.subcategoryKey] || 0) + 1;
      }
    });
    
    // Return subcategories with 2+ notes (dominant ones)
    return Object.keys(subcategoryCounts).filter(subcat => 
      subcategoryCounts[subcat] >= 2
    );
  }

  // Helper: Find dominant subcategories with both keys and clean names
  static getDominantSubcategoriesWithNames(notes) {
    const subcategoryCounts = {};
    const subcategoryInfo = {};
    
    // Ensure notes are normalized before classification
    const normalizedNotes = NoteNormalizer.normalizeArray(notes);
    
    normalizedNotes.forEach(note => {
      const classification = NoteClassifier.classifyNote(note);
      if (classification.subcategoryKey !== 'COMPLEX') {
        const key = classification.subcategoryKey;
        subcategoryCounts[key] = (subcategoryCounts[key] || 0) + 1;
        subcategoryInfo[key] = {
          key: key,
          name: classification.subcategory,
          family: classification.family
        };
      }
    });
    
    // Return subcategories with 2+ notes (dominant ones) with clean names
    return Object.keys(subcategoryCounts)
      .filter(subcat => subcategoryCounts[subcat] >= 2)
      .map(key => subcategoryInfo[key]);
  }

  // Get recommendations based on entire user collection
  static getCollectionBasedRecommendations(userCollection, candidatePerfumes, maxResults = 10) {
    // 1. Create user profile from their collection
    const userProfile = this.createUserProfile(userCollection);
    
    // 2. Score each candidate against the user profile
    const recommendations = candidatePerfumes.map(candidate => {
      const match = this.calculateCollectionMatchScore(candidate, userProfile);
      return {
        perfume: candidate,
        matchScore: match.score,
        reasoning: match.reasoning,
        userProfile: userProfile // Include for transparency
      };
    });
    
    // 3. Sort by match score (highest first)
    return recommendations
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, maxResults);
  }
  
  // Create a profile of user's preferences from their collection
  static createUserProfile(userCollection) {
    const allPerfumes = userCollection.getAllPerfumes();
    if (allPerfumes.length === 0) {
      return { 
        dominantSubcategories: [], 
        signatureNotes: [], 
        intensityPreference: 'Unknown' 
      };
    }
    
    // Analyze subcategory preferences
    const subcategoryAnalysis = userCollection.analyzeSubcategoryPreferences();
    const intensityProfile = userCollection.getIntensityProfile();
    
    // Find dominant subcategories (appear in 40%+ of collection)
    const dominantSubcategories = [];
    const threshold = Math.max(1, Math.ceil(allPerfumes.length * 0.4)); // At least 40% or minimum 1
    
    Object.keys(subcategoryAnalysis).forEach(familyKey => {
      Object.keys(subcategoryAnalysis[familyKey]).forEach(subcategoryKey => {
        const subcatData = subcategoryAnalysis[familyKey][subcategoryKey];
        const count = subcatData.count;
        if (count >= threshold) {
          dominantSubcategories.push({
            key: subcategoryKey,
            name: subcatData.name, // Clean display name
            family: subcatData.family,
            count: count
          });
        }
      });
    });
    
    // Find signature notes (appear in 30%+ of collection)
    const noteFrequency = userCollection.getMostPopularNotes();
    const noteThreshold = Math.max(1, Math.ceil(allPerfumes.length * 0.3));
    const signatureNotes = noteFrequency
      .filter(item => item.count >= noteThreshold)
      .map(item => item.note); // These are already normalized from UserCollection
    
    return {
      dominantSubcategories: dominantSubcategories,
      signatureNotes: signatureNotes,
      intensityPreference: intensityProfile.dominantIntensity,
      collectionSize: allPerfumes.length,
      familyDistribution: userCollection.getFamilyDistribution()
    };
  }
  
  // Calculate how well a candidate matches the user's collection style
  static calculateCollectionMatchScore(candidate, userProfile) {
    let score = 0;
    let maxPossibleScore = 0;
    const reasoning = [];
    
    // Get candidate's normalized characteristics
    const candidateNotes = this.getAllNotes(candidate);
    const candidateSubcategories = this.getDominantSubcategoriesWithNames(candidateNotes);
    
    // 1. SUBCATEGORY MATCH SCORING (40% of total score)
    let subcategoryMatches = 0;
    userProfile.dominantSubcategories.forEach(userSubcat => {
      const matchingCandidate = candidateSubcategories.find(candSubcat => 
        candSubcat.key === userSubcat.key
      );
      if (matchingCandidate) {
        subcategoryMatches++;
        reasoning.push(`Matches your ${userSubcat.name} preference`);
      }
    });
    
    if (userProfile.dominantSubcategories.length > 0) {
      score += (subcategoryMatches / userProfile.dominantSubcategories.length) * 0.4;
      maxPossibleScore += 0.4;
    }
    
    // 2. SIGNATURE NOTE BONUS (30% of total score)
    let signatureNoteMatches = 0;
    userProfile.signatureNotes.forEach(signatureNote => {
      // Normalize signature note for comparison
      const normalizedSignatureNote = NoteNormalizer.normalize(signatureNote);
      if (candidateNotes.some(note => note.toLowerCase() === normalizedSignatureNote.toLowerCase())) {
        signatureNoteMatches++;
        reasoning.push(`Contains your signature note: ${normalizedSignatureNote}`);
      }
    });
    
    if (userProfile.signatureNotes.length > 0) {
      score += (signatureNoteMatches / userProfile.signatureNotes.length) * 0.3;
      maxPossibleScore += 0.3;
    }
    
    // 3. INTENSITY COMPATIBILITY (20% of total score)
    const candidateIntensity = this.determinePerfumeIntensity(candidate);
    if (candidateIntensity === userProfile.intensityPreference) {
      score += 0.2;
      reasoning.push(`Matches your ${userProfile.intensityPreference} intensity preference`);
    }
    maxPossibleScore += 0.2;
    
    // 4. COMPLEMENTARY EXPANSION (10% of total score)
    const complementaryMatch = this.findComplementaryMatches(candidateSubcategories, userProfile.dominantSubcategories);
    if (complementaryMatch.found) {
      score += 0.1;
      reasoning.push(`Complements your style: ${complementaryMatch.reason}`);
    }
    maxPossibleScore += 0.1;
    
    // Normalize score to 0-1 scale
    const normalizedScore = maxPossibleScore > 0 ? score / maxPossibleScore : 0;
    
    return {
      score: Math.round(normalizedScore * 100) / 100,
      reasoning: reasoning.length > 0 ? reasoning : ['Different style - might offer nice variety!']
    };
  }
  
  // Helper: Determine a perfume's overall intensity
  static determinePerfumeIntensity(perfume) {
    const notes = this.getAllNotes(perfume);
    const intensityAnalysis = NoteClassifier.analyzeIntensityProfile(notes);
    
    // Find dominant intensity
    let dominantIntensity = 'Medium'; // default
    let maxCount = 0;
    
    Object.entries(intensityAnalysis).forEach(([intensity, count]) => {
      if (count > maxCount && intensity !== 'Complex') {
        maxCount = count;
        dominantIntensity = intensity;
      }
    });
    
    return dominantIntensity;
  }
  
  // Helper: Find complementary relationships
  static findComplementaryMatches(candidateSubcategories, userSubcategories) {
    for (const userSubcat of userSubcategories) {
      const complements = NoteClassifier.getComplementarySubcategories(userSubcat.key);
      for (const candidateSubcat of candidateSubcategories) {
        if (complements.includes(candidateSubcat.key)) {
          return {
            found: true,
            reason: `${candidateSubcat.name} complements your ${userSubcat.name} style`
          };
        }
      }
    }
    return { found: false };
  }

  // Utility: Normalize candidate perfumes before recommendation processing
  static normalizeCandidatePerfumes(candidatePerfumes) {
    return candidatePerfumes.map(perfume => 
      NoteNormalizer.normalizePerfumeNotes(perfume)
    );
  }

  // Enhanced recommendation method that auto-normalizes candidates
  static findSimilarPerfumesNormalized(targetPerfume, candidatePerfumes, maxResults = 10) {
    // Normalize target perfume and candidates
    const normalizedTarget = NoteNormalizer.normalizePerfumeNotes(targetPerfume);
    const normalizedCandidates = this.normalizeCandidatePerfumes(candidatePerfumes);
    
    return this.findSimilarPerfumes(normalizedTarget, normalizedCandidates, maxResults);
  }

  // Enhanced collection-based recommendations with auto-normalization
  static getCollectionBasedRecommendationsNormalized(userCollection, candidatePerfumes, maxResults = 10) {
    // Normalize candidate perfumes before processing
    const normalizedCandidates = this.normalizeCandidatePerfumes(candidatePerfumes);
    
    return this.getCollectionBasedRecommendations(userCollection, normalizedCandidates, maxResults);
  }
}

export { RecommendationEngine };