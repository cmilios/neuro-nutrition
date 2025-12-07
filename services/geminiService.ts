import { GoogleGenAI, Type, Schema } from "@google/genai";
import { UserProfile, MealPlan, Meal, MealFeedback } from "../types";

const apiKey = process.env.API_KEY || '';

const ai = new GoogleGenAI({ apiKey });

const macroSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    calories: { type: Type.NUMBER },
    protein: { type: Type.NUMBER },
    carbs: { type: Type.NUMBER },
    fats: { type: Type.NUMBER },
  },
  required: ["calories", "protein", "carbs", "fats"]
};

const mealSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING },
    description: { type: Type.STRING },
    ingredients: { 
      type: Type.ARRAY, 
      items: { type: Type.STRING } 
    },
    instructions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Step-by-step cooking instructions."
    },
    macros: macroSchema,
    cookingTimeMinutes: { type: Type.NUMBER },
    prepTimeMinutes: { type: Type.NUMBER }
  },
  required: ["name", "description", "ingredients", "instructions", "macros", "cookingTimeMinutes", "prepTimeMinutes"]
};

const dayPlanSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    day: { type: Type.STRING, description: "Day of the week (e.g., Monday)" },
    breakfast: mealSchema,
    lunch: mealSchema,
    dinner: mealSchema,
    snack: mealSchema,
    dailySummary: macroSchema
  },
  required: ["day", "breakfast", "lunch", "dinner", "snack", "dailySummary"]
};

const mealPlanSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    weeklySummary: { type: Type.STRING, description: "A brief nutritional advice summary for the user based on their biometrics." },
    days: {
      type: Type.ARRAY,
      items: dayPlanSchema
    }
  },
  required: ["weeklySummary", "days"]
};

export const generateMealPlan = async (profile: UserProfile, feedback?: MealFeedback[]): Promise<MealPlan> => {
  if (!apiKey) {
    throw new Error("API Key is missing. Please set the API_KEY environment variable.");
  }

  let feedbackPrompt = "";
  if (feedback && feedback.length > 0) {
    const likedMeals = feedback.filter(f => f.liked).map(f => f.name).join(", ");
    const dislikedMeals = feedback.filter(f => f.cooked && !f.liked).map(f => f.name).join(", ");
    const skippedMeals = feedback.filter(f => !f.cooked).map(f => f.name).join(", ");

    feedbackPrompt = `
    PREVIOUS WEEK REVIEW:
    The user provided the following feedback on their previous plan:
    - LIKED (Do more of this style/ingredients): ${likedMeals || "None"}
    - COOKED BUT DISLIKED (Avoid this style): ${dislikedMeals || "None"}
    - SKIPPED/DID NOT COOK (Maybe too complex or unappealing): ${skippedMeals || "None"}
    
    Optimize the new plan to lean towards the LIKED meals and avoid the DISLIKED ones.
    `;
  }

  const prompt = `
    Act as a world-class nutritionist and clean architecture system.
    Generate a 7-day meal plan for a user with the following biometrics:
    - Age: ${profile.age}
    - Gender: ${profile.gender}
    - Height: ${profile.heightCm} cm
    - Current Weight: ${profile.weightKg} kg
    - Target Weight: ${profile.targetWeightKg ? profile.targetWeightKg + " kg" : "Not specified"}
    - Activity Level: ${profile.activityLevel}
    - Goal: ${profile.goal}
    - Diet Preference: ${profile.dietType}
    - Allergies/Restrictions: ${profile.allergies || 'None'}

    ${feedbackPrompt}

    Calculate their TDEE (Total Daily Energy Expenditure) and adjust the daily caloric intake according to their Goal (Deficit for weight loss, Surplus for muscle gain).
    Ensure each day has a Breakfast, Lunch, Dinner, and Snack.
    Provide step-by-step cooking instructions and separation of prep time vs cooking time.
    Ensure strict strict type adherence for numbers.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: mealPlanSchema,
        temperature: 0.7
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI");

    return JSON.parse(text) as MealPlan;
  } catch (error) {
    console.error("Error generating meal plan:", error);
    throw error;
  }
};

export const regenerateSingleMeal = async (profile: UserProfile, mealType: string): Promise<Meal> => {
  if (!apiKey) {
    throw new Error("API Key is missing. Please set the API_KEY environment variable.");
  }

  const prompt = `
    Act as a world-class nutritionist.
    Generate a single delicious ${mealType} option for a user with the following profile:
    - Goal: ${profile.goal}
    - Diet: ${profile.dietType}
    - Allergies: ${profile.allergies || 'None'}
    
    Ensure the meal is balanced and appropriate for the requested meal type.
    Include detailed step-by-step cooking instructions and prep/cook times.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: mealSchema,
        temperature: 0.8
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI");

    return JSON.parse(text) as Meal;
  } catch (error) {
    console.error("Error regenerating meal:", error);
    throw error;
  }
};