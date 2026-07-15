// Shared quiz widget for lessons. Markup contract:
// <div class="quiz">
//   <p class="quiz-q">...</p>
//   <div class="quiz-choices">
//     <button class="quiz-choice" data-correct="true">...</button>
//     <button class="quiz-choice" data-correct="false">...</button>
//   </div>
//   <p class="quiz-feedback" data-correct-feedback="..." data-incorrect-feedback="..."></p>
// </div>
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.quiz').forEach((quiz) => {
    const choices = quiz.querySelectorAll('.quiz-choice');
    const feedback = quiz.querySelector('.quiz-feedback');
    let answered = false;

    choices.forEach((choice) => {
      choice.addEventListener('click', () => {
        if (answered) return;
        answered = true;

        const isCorrect = choice.dataset.correct === 'true';
        choices.forEach((c) => {
          c.classList.add(c.dataset.correct === 'true' ? 'correct' : 'incorrect');
        });

        if (feedback) {
          feedback.textContent = isCorrect
            ? feedback.dataset.correctFeedback || '答對了。'
            : feedback.dataset.incorrectFeedback || '再想想 — 正確答案已標示為綠色。';
        }
      });
    });
  });
});
