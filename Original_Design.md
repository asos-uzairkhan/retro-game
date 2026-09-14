# Design

- The name of the game is "Data-Tech Among Us Retro"
- The game will be hosted on github pages and accessible through a web browser.
- Google firebase will be used for real-time database to handle data storage and synchronization between players.
- Admin/Host creates a game and is given a code to share with other players so they can join the game.
- Admin/Host is also a player but can not vote on imposter because they already know.
- The game has multiple phases:
    1. Setup phase: Admin/Host sets up the game.
    2. Joining phase: Players join the game using the game code.
    3. Gameplay phase: Players move through rooms, answer questions, and collect clues.
    4. Reflection phase: Players go over the question and answers given during the gameplay phase.
    5. Voting phase: Clues are now revealed to all players. Players vote on who they think the imposter is.
    6. Reveal phase: Votes and the imposter are revealed.
    7. End phase: The game ends and players can review the game summary.
- Before the game is created, the admin/host must set up the suspect list, hints to be found, one suspect as the imposter, size of grid map and number of different room types (Rooms without a type become storage type).
- Players are represented on the map by name tags and colour.
- hints are randomly distributed among the rooms. Player only know their room had a hint when they complete the question in that room.
- Players join using a name, colour and a game code. (Admin/Host create the game in the same manner, the code becomes the room code.)
- a end of sprint retro presented a base inspired by among us
- players start start at the center of the map and move into different rooms where they will be prompted a retro related question.
- Players have to work as a team to answer questions in as many rooms as possible and collect clues to discover who the imposter is.
- There are different types of rooms
    - Storage: Default room, any comment can be left here.
    - Medical bay: Players answer questions related to what didn't go well during the sprint.
    - Recreation room: Players answer questions related to what went well during the sprint.
    - Cafeteria: Players answer questions related to serenity.
    - Engine room: Players answer questions related to ideas for improvement.
    - Navigation: Players answer questions related to learning.
    - Security: Players answer questions related to risks and blockers encountered during the sprint.
    - Conference room: Players answer questions related to teamwork.
- Rooms can only be accessed if they are adjacent to a solved room.
- The type of room visible if the room is accessable.
- Players can click on an accessible room to see the question and then have the option to accept or go back and choose a different room.
- Only one person can be in a room at a time and if they change their mind, they have to leave the room before another player can enter.
- There is only one question per room.
- One of the players is not the imposter, instead the admin has to create a list of people (assigning one as the imposter)and a list of hints. When the retro is over, players can view the clues they found and they indivially vote on who the they think the imposter is from a list of names. When all votes are in or the timer runs out, the players votes are revealed to each other and the imposter is revealed.
