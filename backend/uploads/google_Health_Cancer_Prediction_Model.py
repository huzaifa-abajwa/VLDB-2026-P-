import sys
import pandas as pd
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.preprocessing import StandardScaler

def process_data(dataset_path):
    # Read the dataset
    df = pd.read_csv(dataset_path)
    
    # Convert all column names to lowercase to standardize them
    df.columns = df.columns.str.lower()
    
    # Check if 'status' column exists
    if 'status' not in df.columns:
        return f"Error: 'status' column not found in the dataset {dataset_path}."
    
    # Set the target variable
    y = df['status']
    
    # Drop 'pid' and 'status' columns
    X = df.drop(['pid', 'status'], axis=1, errors='ignore')
    
    # Ensure all features are numeric and handle missing values
    X = X.apply(pd.to_numeric, errors='coerce').fillna(0)
    
    # Split the dataset
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )
    
    # Feature Scaling
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)
    
    # Initialize and train the Logistic Regression model
    model = LogisticRegression(max_iter=1000)
    model.fit(X_train_scaled, y_train)
    
    # Make predictions
    y_pred = model.predict(X_test_scaled)
    
    # Evaluate the model
    conf_matrix = confusion_matrix(y_test, y_pred)
    class_report = classification_report(y_test, y_pred)
    
    result = f"Confusion Matrix:\n{conf_matrix}\n\nClassification Report:\n{class_report}"
    return result

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: google_Health_Cancer_Prediction_Model.py <dataset_path_1> [<dataset_path_2> ...]")
        sys.exit(1)
    dataset_paths = sys.argv[1:]
    results = []
    for dataset_path in dataset_paths:
        result = process_data(dataset_path)
        results.append(result)
    # If multiple results, concatenate them for the frontend
    final_output = "\n\n".join(results)
    print(final_output)
