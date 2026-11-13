-- Ronin Larsen's Lab: 22 YouTube lessons, one per house, in the order Alston sent them (2026-11-13; link 7 repeated link 1).
-- Run once in the Supabase SQL editor. It first removes the 11 old Fox Pest Control test videos, and stops
-- without changing anything if the new lessons are already there.
-- Each lesson plays inside the app and has a 4-question quiz; 3 of 4 right passes and opens the next house.

DO $$
DECLARE
  co uuid;
  pl uuid;
  v uuid;
  old_n int;
BEGIN
  SELECT id INTO co FROM companies WHERE name ILIKE 'ronin larsen';
  IF co IS NULL THEN RAISE EXCEPTION 'No company named Ronin Larsen'; END IF;

  -- Clear out the 11 old Fox Pest Control test videos (all dated before today) and any old playlists.
  -- Their quiz questions and watch history go with them. If the count isn't 11, stop and change nothing.
  SELECT count(*) INTO old_n FROM training_videos WHERE company_id = co AND created_at < '2026-11-13';
  IF old_n NOT IN (0, 11) THEN RAISE EXCEPTION 'Expected 11 old test videos, found %; nothing was changed', old_n; END IF;
  DELETE FROM training_videos WHERE company_id = co AND created_at < '2026-11-13';
  DELETE FROM training_playlists WHERE company_id = co AND created_at < '2026-11-13';
  IF EXISTS (SELECT 1 FROM training_videos WHERE company_id = co) THEN
    RAISE EXCEPTION 'Ronin''s Lab already has the new lessons; nothing was changed';
  END IF;

  -- Unit 1: The approach
  INSERT INTO training_playlists (company_id, name, created_at) VALUES (co, 'The approach', now() + interval '0 seconds') RETURNING id INTO pl;
  -- 1. Selling peace of mind  (YouTube: The Fox Service)
  INSERT INTO training_videos (company_id, title, description, video_type, youtube_url, duration, created_at)
    VALUES (co, 'Selling peace of mind', 'What the service really is: not spraying bugs, a bug-free home.', 'youtube', 'https://www.youtube.com/watch?v=48s_mOnG2F4', 156, now() + interval '1 seconds') RETURNING id INTO v;
  INSERT INTO playlist_videos (playlist_id, video_id, position) VALUES (pl, v, 0);
  INSERT INTO video_quiz_settings (video_id, quiz_required, passing_score) VALUES (v, true, 75);
  INSERT INTO video_quiz_questions (video_id, question_text, option_a, option_b, option_c, option_d, correct_answer, position) VALUES
    (v, 'What are you really selling the customer?', 'The cheapest spray in the area', 'Peace of mind and a bug-free home', 'A one-time treatment', 'A lawn care plan', 'B', 0),
    (v, 'What''s a safe thing to say if you don''t know a home''s exact treatment?', '"We spray everything every month."', '"You''ll never see a bug again."', '"The technician will do a full inspection and make a custom plan for your home."', '"Ask the office, I just knock doors."', 'C', 1),
    (v, 'Where does the bulk of the work happen?', 'The exterior of the home', 'The attic', 'Inside the kitchen', 'The garage only', 'A', 2),
    (v, '"Pest control is not an event, it''s a..."', 'Contract', 'Chemical', 'Season', 'Process', 'D', 3);
  -- 2. Qualifying the decision maker  (YouTube: The Initial Approach)
  INSERT INTO training_videos (company_id, title, description, video_type, youtube_url, duration, created_at)
    VALUES (co, 'Qualifying the decision maker', 'Your first 10 seconds, and making sure you''re talking to the person who says yes.', 'youtube', 'https://www.youtube.com/watch?v=29y-S0aDk64', 104, now() + interval '2 seconds') RETURNING id INTO v;
  INSERT INTO playlist_videos (playlist_id, video_id, position) VALUES (pl, v, 1);
  INSERT INTO video_quiz_settings (video_id, quiz_required, passing_score) VALUES (v, true, 75);
  INSERT INTO video_quiz_questions (video_id, question_text, option_a, option_b, option_c, option_d, correct_answer, position) VALUES
    (v, 'What does qualifying the buyer mean?', 'Checking their credit score', 'Finding out if you''re talking to the decision maker', 'Asking if they have bugs', 'Getting their phone number', 'B', 0),
    (v, 'Why qualify early in the pitch?', 'So you don''t give all the details to someone who can''t say yes', 'So the pitch takes longer', 'So you can skip the close', 'So you can leave a card', 'A', 1),
    (v, 'Someone says "I''m the roommate, we rent." What''s the move?', 'Leave right away', 'Close them on the spot', 'Ask more questions to see if they make the decision', 'Give them a flyer', 'C', 2),
    (v, 'Which line qualifies the buyer?', '"Are you seeing any bugs?"', '"Can I get your email?"', '"Do you want half off?"', '"I take it you''re the one in charge around here?"', 'D', 3);
  -- 3. Sparking curiosity at the door  (YouTube: Building Interest)
  INSERT INTO training_videos (company_id, title, description, video_type, youtube_url, duration, created_at)
    VALUES (co, 'Sparking curiosity at the door', 'Grab attention in 3 to 7 seconds and pull them into the conversation.', 'youtube', 'https://www.youtube.com/watch?v=NrHkzPxnbgE', 152, now() + interval '3 seconds') RETURNING id INTO v;
  INSERT INTO playlist_videos (playlist_id, video_id, position) VALUES (pl, v, 2);
  INSERT INTO video_quiz_settings (video_id, quiz_required, passing_score) VALUES (v, true, 75);
  INSERT INTO video_quiz_questions (video_id, question_text, option_a, option_b, option_c, option_d, correct_answer, position) VALUES
    (v, 'How long do you have to grab the customer''s attention?', 'About 3 to 7 seconds', 'About 1 minute', 'About 30 seconds', 'As long as you need', 'A', 0),
    (v, 'What usually happens without curiosity?', 'They ask about price', 'They default to "I''m not interested"', 'They invite you in', 'They ask for a card', 'B', 1),
    (v, 'Which opener builds curiosity best?', '"I''m here to sell you pest control."', '"Do you want to sign up today?"', '"Quick heads up, I''m the guy taking care of John and Misty and about 15 of your neighbors."', '"Sorry to bother you."', 'C', 2),
    (v, 'Name-dropping neighbors uses which effect?', 'The scarcity effect', 'The anchor effect', 'The halo effect', 'The bandwagon effect', 'D', 3);
  -- 4. Creating urgency on the doorstep  (YouTube: Building Urgency)
  INSERT INTO training_videos (company_id, title, description, video_type, youtube_url, duration, created_at)
    VALUES (co, 'Creating urgency on the doorstep', 'Give them a reason to act now, framed as a heads up, not a hard sell.', 'youtube', 'https://www.youtube.com/watch?v=h9JUmsycEBU', 177, now() + interval '4 seconds') RETURNING id INTO v;
  INSERT INTO playlist_videos (playlist_id, video_id, position) VALUES (pl, v, 3);
  INSERT INTO video_quiz_settings (video_id, quiz_required, passing_score) VALUES (v, true, 75);
  INSERT INTO video_quiz_questions (video_id, question_text, option_a, option_b, option_c, option_d, correct_answer, position) VALUES
    (v, 'Why create urgency early?', 'It takes away the option to delay', 'It makes the pitch longer', 'It scares the customer into buying', 'It lets you skip qualifying', 'A', 0),
    (v, 'Which line creates urgency the right way?', '"Your house is about to be overrun."', '"If I can squeeze you in while I''m here, I''ll be super quick."', '"This deal ends in 30 seconds."', '"I''ll come back next week."', 'B', 1),
    (v, 'What should urgency never do?', 'Mention neighbors', 'Mention a discount', 'Alarm, frighten or startle the customer', 'Use the word "today"', 'C', 2),
    (v, 'Which four pieces make a strong initial approach?', 'Price, contract, card, signature', 'Joke, compliment, price, close', 'Card, flyer, website, callback', 'Qualifying, curiosity, bandwagon, urgency', 'D', 3);
  -- 5. Spotting the golden question  (YouTube: The Golden Question(s))
  INSERT INTO training_videos (company_id, title, description, video_type, youtube_url, duration, created_at)
    VALUES (co, 'Spotting the golden question', 'Buying signs: any question or signal that they''re moving toward yes.', 'youtube', 'https://www.youtube.com/watch?v=qWKEAF9yh7I', 72, now() + interval '5 seconds') RETURNING id INTO v;
  INSERT INTO playlist_videos (playlist_id, video_id, position) VALUES (pl, v, 4);
  INSERT INTO video_quiz_settings (video_id, quiz_required, passing_score) VALUES (v, true, 75);
  INSERT INTO video_quiz_questions (video_id, question_text, option_a, option_b, option_c, option_d, correct_answer, position) VALUES
    (v, 'What is the golden question?', 'Only asking about price', 'Any sign the customer is moving toward a buying decision', 'Asking for their last name', 'The first question you ask', 'B', 0),
    (v, 'Which of these is a buying sign?', '"Do I need to be here when you guys come by?"', '"We''re not interested."', '"Can I get a card?"', '"I''m on my way out."', 'A', 1),
    (v, 'Besides questions, what else counts as buying behavior?', 'Closing the door halfway', 'Checking their phone', 'Head nods and saying "okay"', 'Looking at your truck', 'C', 2),
    (v, 'What if the customer isn''t asking questions or engaged?', 'Leave a card and go', 'Ask for the sale right away', 'Lower the price', 'Keep educating them by building value in the service', 'D', 3);
  -- 6. Body language that sells  (YouTube: Body Language)
  INSERT INTO training_videos (company_id, title, description, video_type, youtube_url, duration, created_at)
    VALUES (co, 'Body language that sells', 'Most of what customers take in is what they see. Stand, move and talk with confidence.', 'youtube', 'https://www.youtube.com/watch?v=grL1y7-7__4', 152, now() + interval '6 seconds') RETURNING id INTO v;
  INSERT INTO playlist_videos (playlist_id, video_id, position) VALUES (pl, v, 5);
  INSERT INTO video_quiz_settings (video_id, quiz_required, passing_score) VALUES (v, true, 75);
  INSERT INTO video_quiz_questions (video_id, question_text, option_a, option_b, option_c, option_d, correct_answer, position) VALUES
    (v, 'About how much of communication is nonverbal?', '10%', '25%', '55%', '90%', 'C', 0),
    (v, 'How should you stand on the doorstep?', 'At a 45 degree angle, not squared up', 'Squared off, facing them head on', 'Completely sideways', 'Leaning on the door frame', 'A', 1),
    (v, 'About how far from the door should you stand?', 'Right at the door', 'About five feet', 'About fifteen feet', 'Back on the sidewalk', 'B', 2),
    (v, 'What do first-year reps struggle with most?', 'Smiling too much', 'Pointing with a pen', 'Standing too far away', 'Talking slowly and clearly', 'D', 3);

  -- Unit 2: Building value
  INSERT INTO training_playlists (company_id, name, created_at) VALUES (co, 'Building value', now() + interval '1 seconds') RETURNING id INTO pl;
  -- 7. Building value around their concern  (YouTube: Building Value)
  INSERT INTO training_videos (company_id, title, description, video_type, youtube_url, duration, created_at)
    VALUES (co, 'Building value around their concern', 'Tailor the pitch to the bug they bring up, and ask open-ended questions.', 'youtube', 'https://www.youtube.com/watch?v=PM8frVbvSiQ', 144, now() + interval '8 seconds') RETURNING id INTO v;
  INSERT INTO playlist_videos (playlist_id, video_id, position) VALUES (pl, v, 0);
  INSERT INTO video_quiz_settings (video_id, quiz_required, passing_score) VALUES (v, true, 75);
  INSERT INTO video_quiz_questions (video_id, question_text, option_a, option_b, option_c, option_d, correct_answer, position) VALUES
    (v, 'The customer mentions ants in the backyard. What do you talk about?', 'Wasps and mice too, to cover everything', 'The ants, and where they''re seeing them', 'The price right away', 'The contract length', 'B', 0),
    (v, 'Why tailor the service to the customer''s concern?', 'The more relevant the pitch feels, the more valuable the service becomes', 'It makes the pitch shorter', 'It lets you skip the close', 'It avoids talking about price', 'A', 1),
    (v, 'Which is an open-ended question?', '"Are you seeing any bugs?"', '"Do you want pest control?"', '"Do you have a problem with wasps?"', '"Where are you seeing the ants you mentioned?"', 'D', 2),
    (v, 'Why ask open-ended questions?', 'To fill time', 'To get a quick no', 'They make it a conversation and pinpoint what the customer needs', 'To find out their budget', 'C', 3);
  -- 8. Assumptive language: when, not if  (YouTube: Assumptive Language)
  INSERT INTO training_videos (company_id, title, description, video_type, youtube_url, duration, created_at)
    VALUES (co, 'Assumptive language: when, not if', 'Talk as if they''re already getting the service.', 'youtube', 'https://www.youtube.com/watch?v=4gE0hbqBl6o', 62, now() + interval '9 seconds') RETURNING id INTO v;
  INSERT INTO playlist_videos (playlist_id, video_id, position) VALUES (pl, v, 1);
  INSERT INTO video_quiz_settings (video_id, quiz_required, passing_score) VALUES (v, true, 75);
  INSERT INTO video_quiz_questions (video_id, question_text, option_a, option_b, option_c, option_d, correct_answer, position) VALUES
    (v, 'Assuming the sale means talking about the service in terms of...', 'If they get it', 'When they get it', 'Whether they can afford it', 'What the neighbors think', 'B', 0),
    (v, 'Which line is assumptive?', '"When my technician comes out, he''ll treat all of your eaves."', '"We dust the eaves of homes."', '"If you sign up, we might treat the eaves."', '"Some customers get their eaves done."', 'A', 1),
    (v, 'Where should you use assumptive language?', 'Only at the close', 'Only with repeat customers', 'Never in role plays', 'All through your pitch and role plays', 'D', 2),
    (v, 'What does assumptive language build while you explain value?', 'Doubt', 'Silence', 'Momentum', 'Objections', 'C', 3);
  -- 9. Asking for the yes  (YouTube: Closing)
  INSERT INTO training_videos (company_id, title, description, video_type, youtube_url, duration, created_at)
    VALUES (co, 'Asking for the yes', 'Closing isn''t pushy. It''s clear, natural and assumptive.', 'youtube', 'https://www.youtube.com/watch?v=Uv7KhrEo92A', 95, now() + interval '10 seconds') RETURNING id INTO v;
  INSERT INTO playlist_videos (playlist_id, video_id, position) VALUES (pl, v, 2);
  INSERT INTO video_quiz_settings (video_id, quiz_required, passing_score) VALUES (v, true, 75);
  INSERT INTO video_quiz_questions (video_id, question_text, option_a, option_b, option_c, option_d, correct_answer, position) VALUES
    (v, 'What is the purpose of the close?', 'To pressure the customer', 'To help the customer take the next step', 'To end the conversation', 'To explain the contract', 'B', 0),
    (v, 'Why do most deals get lost?', 'The price is too high', 'The customer had a company', 'The rep never confidently asked for the yes', 'The pitch was too short', 'C', 1),
    (v, 'People in general follow...', 'Certainty', 'Discounts', 'Long pitches', 'Paperwork', 'A', 2),
    (v, 'What does a close usually look like?', 'A big dramatic "are you ready to sign?"', 'A long silence', 'Handing them a card', 'A simple conversational transition', 'D', 3);

  -- Unit 3: Reading objections
  INSERT INTO training_playlists (company_id, name, created_at) VALUES (co, 'Reading objections', now() + interval '2 seconds') RETURNING id INTO pl;
  -- 10. Smoke screens, real concerns and hard nos  (YouTube: Types of Objections)
  INSERT INTO training_videos (company_id, title, description, video_type, youtube_url, duration, created_at)
    VALUES (co, 'Smoke screens, real concerns and hard nos', 'The three kinds of no, and how to spend your time on each.', 'youtube', 'https://www.youtube.com/watch?v=DxeObWsu8Nk', 361, now() + interval '11 seconds') RETURNING id INTO v;
  INSERT INTO playlist_videos (playlist_id, video_id, position) VALUES (pl, v, 0);
  INSERT INTO video_quiz_settings (video_id, quiz_required, passing_score) VALUES (v, true, 75);
  INSERT INTO video_quiz_questions (video_id, question_text, option_a, option_b, option_c, option_d, correct_answer, position) VALUES
    (v, 'What are the three categories of objections?', 'Price, timing, spouse', 'Smoke screens, resolvable concerns, unresolvable concerns', 'Hard, soft, maybe', 'Inside, outside, yard', 'B', 0),
    (v, '"Can I get a card?" right at the start is usually a...', 'Smoke screen', 'Resolvable concern', 'Situational roadblock', 'Buying sign', 'A', 1),
    (v, '"Is it safe for my dog?" is a...', 'Smoke screen', 'Hard no', 'Reason to leave', 'Resolvable concern', 'D', 2),
    (v, 'A U-Haul is in the driveway and they say they''re moving. What do you do?', 'Push past three nos', 'Offer a bigger discount', 'It''s a situational roadblock: move on', 'Ask for their spouse', 'C', 3);
  -- 11. The five most common objections  (YouTube: 5 Common Objections)
  INSERT INTO training_videos (company_id, title, description, video_type, youtube_url, duration, created_at)
    VALUES (co, 'The five most common objections', 'Already have a company, spouse, not interested, do-it-yourself, and price.', 'youtube', 'https://www.youtube.com/watch?v=2xrxJILNIZ4', 83, now() + interval '12 seconds') RETURNING id INTO v;
  INSERT INTO playlist_videos (playlist_id, video_id, position) VALUES (pl, v, 1);
  INSERT INTO video_quiz_settings (video_id, quiz_required, passing_score) VALUES (v, true, 75);
  INSERT INTO video_quiz_questions (video_id, question_text, option_a, option_b, option_c, option_d, correct_answer, position) VALUES
    (v, 'Which is NOT one of the five most common objections?', 'Spouse objection', '"I''m allergic to bugs"', 'Do-it-yourself', 'Concerns about the price', 'B', 0),
    (v, 'On the doors, an objection is...', 'The end of the conversation', 'A reason to leave', 'The beginning of the conversation', 'Something to ignore', 'C', 1),
    (v, 'How do the best reps treat objections?', 'They embrace them', 'They avoid them', 'They argue with them', 'They hand over a card', 'A', 2),
    (v, 'Objections aren''t rejections. They''re...', 'Smoke screens', 'Hard nos', 'Wasted time', 'Buying signs in disguise', 'D', 3);
  -- 12. The switchover  (YouTube: The Switch Over)
  INSERT INTO training_videos (company_id, title, description, video_type, youtube_url, duration, created_at)
    VALUES (co, 'The switchover', 'They already have a company, so they already see the value. Show them why to upgrade.', 'youtube', 'https://www.youtube.com/watch?v=HsDRsATOKoI', 130, now() + interval '13 seconds') RETURNING id INTO v;
  INSERT INTO playlist_videos (playlist_id, video_id, position) VALUES (pl, v, 2);
  INSERT INTO video_quiz_settings (video_id, quiz_required, passing_score) VALUES (v, true, 75);
  INSERT INTO video_quiz_questions (video_id, question_text, option_a, option_b, option_c, option_d, correct_answer, position) VALUES
    (v, 'Why is it good news when they already have a company?', 'They already see the value in paying for pest control', 'They''ll cancel today', 'You can skip the pitch', 'They won''t have objections', 'A', 0),
    (v, 'What tone should you use?', 'Challenging', 'Casual and confident, conversational', 'Fast and pushy', 'Quiet and apologetic', 'B', 1),
    (v, 'What''s often true once you ask about their current company?', 'They pay much less', 'They love their technician', 'It''s only a lawn company, nothing for the home', 'They have a lifetime contract', 'C', 2),
    (v, 'How should you ask about their current service?', 'Like an interview, one question after another', 'Don''t ask, just pitch', 'Ask for their bill', 'Casual questions, never sounding like an interrogation', 'D', 3);
  -- 13. "I do it myself"  (YouTube: "I Do It Myself...")
  INSERT INTO training_videos (company_id, title, description, video_type, youtube_url, duration, created_at)
    VALUES (co, '"I do it myself"', 'The DIY customer: find what they''re fighting, then show the bigger value.', 'youtube', 'https://www.youtube.com/watch?v=zMhfzRUdgeI', 77, now() + interval '14 seconds') RETURNING id INTO v;
  INSERT INTO playlist_videos (playlist_id, video_id, position) VALUES (pl, v, 3);
  INSERT INTO video_quiz_settings (video_id, quiz_required, passing_score) VALUES (v, true, 75);
  INSERT INTO video_quiz_questions (video_id, question_text, option_a, option_b, option_c, option_d, correct_answer, position) VALUES
    (v, 'The do-it-yourself objection can also be a...', 'Situational roadblock', 'Smoke screen', 'Buying sign', 'Spouse objection', 'B', 0),
    (v, 'Why do some people do it themselves?', 'They take pride in it or find it cheaper', 'They can''t find a company', 'They''re moving soon', 'They don''t have bugs', 'A', 1),
    (v, 'What''s your job with a DIY customer?', 'Agree and leave', 'Tell them they''re doing it wrong', 'Talk about the contract', 'Show them the service gives more value and saves money down the road', 'D', 2),
    (v, 'How does the example rep open after "I just do it myself"?', '"That stuff doesn''t work."', '"Can I talk to your spouse?"', '"Well, I''m glad you''re doing something, it''s buggy out here."', '"Here''s my card."', 'C', 3);

  -- Unit 4: Overcoming objections
  INSERT INTO training_playlists (company_id, name, created_at) VALUES (co, 'Overcoming objections', now() + interval '3 seconds') RETURNING id INTO pl;
  -- 14. "It's too expensive"  (YouTube: "Its Too Expensive...")
  INSERT INTO training_videos (company_id, title, description, video_type, youtube_url, duration, created_at)
    VALUES (co, '"It''s too expensive"', 'Price concerns in their many forms, and how to answer with value.', 'youtube', 'https://www.youtube.com/watch?v=1l-eBwGH5kU', 50, now() + interval '15 seconds') RETURNING id INTO v;
  INSERT INTO playlist_videos (playlist_id, video_id, position) VALUES (pl, v, 0);
  INSERT INTO video_quiz_settings (video_id, quiz_required, passing_score) VALUES (v, true, 75);
  INSERT INTO video_quiz_questions (video_id, question_text, option_a, option_b, option_c, option_d, correct_answer, position) VALUES
    (v, 'Which is a form of the price objection?', '"That''s more than my previous company."', '"I need to ask my wife."', '"I do it myself."', '"Can I get a card?"', 'A', 0),
    (v, 'How does the example rep start the response?', 'By cutting the price in half', 'By agreeing it''s expensive and leaving', '"I hear you", and if it would stop you paying the mortgage it may not be a fit right now', 'By talking about the contract', 'C', 1),
    (v, 'Why do neighbors end up jumping on?', 'It''s free', 'Once they see the value and the discounts, it''s a no-brainer', 'Their HOA requires it', 'They lost a bet', 'B', 2),
    (v, 'What''s the response built on?', 'Pressure', 'A lower price', 'Skipping the objection', 'Showing value and the discount', 'D', 3);
  -- 15. "Not interested"  (YouTube: "Not Interested...")
  INSERT INTO training_videos (company_id, title, description, video_type, youtube_url, duration, created_at)
    VALUES (co, '"Not interested"', 'Smoke screen, real concern or hard no: figure out which one it is.', 'youtube', 'https://www.youtube.com/watch?v=b3txso3oFxU', 91, now() + interval '16 seconds') RETURNING id INTO v;
  INSERT INTO playlist_videos (playlist_id, video_id, position) VALUES (pl, v, 1);
  INSERT INTO video_quiz_settings (video_id, quiz_required, passing_score) VALUES (v, true, 75);
  INSERT INTO video_quiz_questions (video_id, question_text, option_a, option_b, option_c, option_d, correct_answer, position) VALUES
    (v, 'The not-interested objection can be...', 'Only a smoke screen', 'A smoke screen, a resolvable concern or an unresolvable concern', 'Only a hard no', 'Only about price', 'B', 0),
    (v, 'What does "not interested" usually mean?', 'They don''t understand the value yet. It''s a knee-jerk reaction', 'They hate pest control', 'They already signed with you', 'They want a bigger discount', 'A', 1),
    (v, 'It sounds like a resolvable "not interested." What do you ask?', '"Why not?"', '"Are you sure?"', '"Can I come back later?"', '"Do you guys already have a company or have you been doing it yourself?"', 'D', 2),
    (v, 'Why not just leave a card?', 'Cards cost money', 'It''s against the rules', 'Cards get tossed on the counter, they never call, and they miss the discount', 'Cards are for managers only', 'C', 3);
  -- 16. The spouse objection  (YouTube: Spouse Objection)
  INSERT INTO training_videos (company_id, title, description, video_type, youtube_url, duration, created_at)
    VALUES (co, 'The spouse objection', 'Prevent it by qualifying early. Handle it, or set a return appointment.', 'youtube', 'https://www.youtube.com/watch?v=6jHsD8k3pVA', 261, now() + interval '17 seconds') RETURNING id INTO v;
  INSERT INTO playlist_videos (playlist_id, video_id, position) VALUES (pl, v, 2);
  INSERT INTO video_quiz_settings (video_id, quiz_required, passing_score) VALUES (v, true, 75);
  INSERT INTO video_quiz_questions (video_id, question_text, option_a, option_b, option_c, option_d, correct_answer, position) VALUES
    (v, 'What''s the best way to prevent the spouse objection?', 'Qualify the buyer early in the conversation', 'Talk faster', 'Skip to the price', 'Only knock when both are home', 'A', 0),
    (v, 'If you can''t reach the real decision maker, what do you do?', 'Leave a card', 'Close the person you''re with anyway', 'Find out when they''ll be home and set a return appointment', 'Move on for good', 'C', 1),
    (v, 'When the spouse comes out, where do you start?', 'At the price', 'From your intro, going over everything', 'At the contract', 'With the welcome sheet', 'B', 2),
    (v, 'When is it best to set callbacks?', 'First thing in the morning', 'At lunchtime', 'Any time they say', 'After dark, on your way out', 'D', 3);
  -- 17. ARAC: acknowledge, resolve, ace, close  (YouTube: Overcoming Objections I)
  INSERT INTO training_videos (company_id, title, description, video_type, youtube_url, duration, created_at)
    VALUES (co, 'ARAC: acknowledge, resolve, ace, close', 'Four steps for any objection, and never stop at the answer.', 'youtube', 'https://www.youtube.com/watch?v=bE2IK0hP6Yk', 202, now() + interval '18 seconds') RETURNING id INTO v;
  INSERT INTO playlist_videos (playlist_id, video_id, position) VALUES (pl, v, 3);
  INSERT INTO video_quiz_settings (video_id, quiz_required, passing_score) VALUES (v, true, 75);
  INSERT INTO video_quiz_questions (video_id, question_text, option_a, option_b, option_c, option_d, correct_answer, position) VALUES
    (v, 'What does ARAC stand for?', 'Ask, react, agree, confirm', 'Acknowledge, resolve, ace, close', 'Approach, rapport, ask, close', 'Answer, repeat, add, call', 'B', 0),
    (v, 'How should you acknowledge an objection?', 'Without validating it: they feel heard, not right to say no', 'By agreeing they made the right choice', 'By ignoring it', 'By repeating the price', 'A', 1),
    (v, 'Which is an "ace"?', 'Raising the price', 'Asking for their spouse', 'Leaving a card', 'Throwing in the shed or garage for free', 'D', 2),
    (v, 'What should you avoid after answering their concern?', 'Asking for their phone number', 'Moving forward in the pitch', 'Waiting in silence', 'Mentioning neighbors', 'C', 3);
  -- 18. Feel, felt, found  (YouTube: Overcoming Objections II)
  INSERT INTO training_videos (company_id, title, description, video_type, youtube_url, duration, created_at)
    VALUES (co, 'Feel, felt, found', 'Show them others felt the same way, and what they found.', 'youtube', 'https://www.youtube.com/watch?v=KrE_uWnlias', 142, now() + interval '19 seconds') RETURNING id INTO v;
  INSERT INTO playlist_videos (playlist_id, video_id, position) VALUES (pl, v, 4);
  INSERT INTO video_quiz_settings (video_id, quiz_required, passing_score) VALUES (v, true, 75);
  INSERT INTO video_quiz_questions (video_id, question_text, option_a, option_b, option_c, option_d, correct_answer, position) VALUES
    (v, 'What does feel, felt, found help the customer feel?', 'Rushed', 'Heard, and that you''re on their team', 'Confused', 'Pressured', 'B', 0),
    (v, 'In the mice example, what did John find?', 'Mice don''t come back in winter', 'DIY traps worked fine', 'Sealing entry points saved him thousands', 'He didn''t need a service', 'C', 1),
    (v, 'In five years and over a thousand accounts, about how many sold with no objections?', 'About 10', 'About 100', 'About 500', 'Most of them', 'A', 2),
    (v, 'How should you treat an objection?', 'Fear it', 'Avoid it', 'Argue with it', 'Embrace it: it''s the chance to build value', 'D', 3);

  -- Unit 5: Locking it in
  INSERT INTO training_playlists (company_id, name, created_at) VALUES (co, 'Locking it in', now() + interval '4 seconds') RETURNING id INTO pl;
  -- 19. The welcome sheet keeps customers  (YouTube: The Welcome Sheet)
  INSERT INTO training_videos (company_id, title, description, video_type, youtube_url, duration, created_at)
    VALUES (co, 'The welcome sheet keeps customers', 'Set expectations after every sale and your cancellations drop.', 'youtube', 'https://www.youtube.com/watch?v=8NiiIC6uMVI', 202, now() + interval '20 seconds') RETURNING id INTO v;
  INSERT INTO playlist_videos (playlist_id, video_id, position) VALUES (pl, v, 0);
  INSERT INTO video_quiz_settings (video_id, quiz_required, passing_score) VALUES (v, true, 75);
  INSERT INTO video_quiz_questions (video_id, question_text, option_a, option_b, option_c, option_d, correct_answer, position) VALUES
    (v, 'What is the welcome sheet designed to do?', 'Collect payment', 'Set proper expectations and train them to be a good customer', 'Replace the contract', 'Advertise other services', 'B', 0),
    (v, 'When do you go over the welcome sheet?', 'After every sale, whatever the service', 'Only for big accounts', 'Only if they ask', 'At the first service', 'A', 1),
    (v, 'After the digital welcome sheet was added, about what was Cameron''s cancellation rate?', '10%', '25%', '8%', '1.6%', 'D', 2),
    (v, 'How should the customer sign the paper copy?', 'One signature at the bottom', 'They don''t need to sign', 'Initial every line or checkbox, then sign', 'Sign the back', 'C', 3);
  -- 20. The top-to-bottom service  (YouTube: The Fox Service II)
  INSERT INTO training_videos (company_id, title, description, video_type, youtube_url, duration, created_at)
    VALUES (co, 'The top-to-bottom service', 'Eaves to foundation to yard, and walking them to where they see the bugs.', 'youtube', 'https://www.youtube.com/watch?v=6KLwwivlj6k', 181, now() + interval '21 seconds') RETURNING id INTO v;
  INSERT INTO playlist_videos (playlist_id, video_id, position) VALUES (pl, v, 1);
  INSERT INTO video_quiz_settings (video_id, quiz_required, passing_score) VALUES (v, true, 75);
  INSERT INTO video_quiz_questions (video_id, question_text, option_a, option_b, option_c, option_d, correct_answer, position) VALUES
    (v, 'What does the technician use first on the upper part of the home?', 'A Webster pole for cobwebs and wasp nests', 'A leaf blower', 'A ladder and paint', 'Bait stations', 'A', 0),
    (v, 'Why is the foundation treatment so important?', 'It makes the home look newer', 'It''s where most activity gets in, and it leaves a residual barrier', 'It''s the only thing in the contract', 'It treats the lawn too', 'B', 1),
    (v, 'What if they see bugs between quarterly services?', 'They pay for an extra visit', 'They wait for the next quarter', 'They call back anytime at no extra charge', 'They buy spray at the store', 'C', 2),
    (v, 'They mention mice in the shed. What do you do?', 'Talk about wasps instead', 'Promise the mice are gone forever', 'Tell them to ask the technician', 'Walk them to the shed and show how the service handles it', 'D', 3);
  -- 21. Soft closes and hard closes  (YouTube: Closing II)
  INSERT INTO training_videos (company_id, title, description, video_type, youtube_url, duration, created_at)
    VALUES (co, 'Soft closes and hard closes', 'Close all through the pitch, read their temperature, then lock it in.', 'youtube', 'https://www.youtube.com/watch?v=WkUH-6haDYU', 216, now() + interval '22 seconds') RETURNING id INTO v;
  INSERT INTO playlist_videos (playlist_id, video_id, position) VALUES (pl, v, 2);
  INSERT INTO video_quiz_settings (video_id, quiz_required, passing_score) VALUES (v, true, 75);
  INSERT INTO video_quiz_questions (video_id, question_text, option_a, option_b, option_c, option_d, correct_answer, position) VALUES
    (v, 'When should closing happen?', 'Only at the very end', 'Frequently, throughout the sale', 'Only after the price', 'Only if they ask', 'B', 0),
    (v, 'What is a soft close?', 'Gauging the customer''s temperature', 'Asking for their card', 'Leaving a flyer', 'Repeating the price', 'A', 1),
    (v, 'Which is a hard close?', '"Do you want the inside done too?"', '"Seen many bugs lately?"', '"Who''s your current company?"', 'Asking for their last name, or credit or debit', 'D', 2),
    (v, 'If you don''t know where to go next in your pitch, what''s the rule of thumb?', 'Start over', 'Leave', 'Close the customer', 'Talk about the neighbors', 'C', 3);
  -- 22. Walking through the welcome sheet  (YouTube: The Welcome Sheet II)
  INSERT INTO training_videos (company_id, title, description, video_type, youtube_url, duration, created_at)
    VALUES (co, 'Walking through the welcome sheet', 'Every section, from the guarantee to the signature.', 'youtube', 'https://www.youtube.com/watch?v=4FPB5Fe2bQk', 255, now() + interval '23 seconds') RETURNING id INTO v;
  INSERT INTO playlist_videos (playlist_id, video_id, position) VALUES (pl, v, 3);
  INSERT INTO video_quiz_settings (video_id, quiz_required, passing_score) VALUES (v, true, 75);
  INSERT INTO video_quiz_questions (video_id, question_text, option_a, option_b, option_c, option_d, correct_answer, position) VALUES
    (v, 'Which pests are NOT covered by the home protection plan?', 'Ants and spiders', 'Termites and mosquitoes', 'Wasps and mice', 'Crickets and earwigs', 'B', 0),
    (v, 'How long are most contracts?', 'Two years', 'Six months', 'One year', 'Month to month', 'A', 1),
    (v, 'How often is the home treated, and how are they billed?', 'Monthly visits, billed quarterly', 'Once a year, billed yearly', 'Twice a year, billed monthly', 'Quarterly visits, billed monthly', 'D', 2),
    (v, 'After a treatment, how long should they wait before calling about activity?', 'One day', 'One week', 'Three to four weeks', 'Six months', 'C', 3);
END $$;

-- Check: 22 lessons, 4 questions each, in order
SELECT p.name AS unit, pv.position + 1 AS house, tv.title, (SELECT count(*) FROM video_quiz_questions qq WHERE qq.video_id = tv.id) AS questions
FROM training_videos tv JOIN playlist_videos pv ON pv.video_id = tv.id JOIN training_playlists p ON p.id = pv.playlist_id
WHERE tv.company_id = (SELECT id FROM companies WHERE name ILIKE 'ronin larsen')
ORDER BY tv.created_at;
